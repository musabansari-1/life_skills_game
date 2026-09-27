/**
 * Fake provider for tests and key-less local runs.
 *
 * Produces *plausible, schema-valid* output for every task using cheap
 * heuristics on the latest player message. It is deliberately simple; the
 * point is to exercise the deterministic game loop without model calls.
 * Set `AI_PROVIDER=fake` to run the whole game on it.
 */
import type { CompletionRequest, CompletionResult, LLMProvider } from "../provider";
import { MOVES_CLOSE, MOVES_OPEN, SPEECH_CLOSE, SPEECH_OPEN } from "../format";

export interface FakeProviderOptions {
  /** Override outputs for a task (e.g. to test invalid output handling). */
  scripted?: Partial<Record<CompletionRequest["task"], (req: CompletionRequest) => string>>;
  /** Simulated latency per call, ms. */
  latencyMs?: number;
}

export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  calls: CompletionRequest[] = [];
  constructor(private opts: FakeProviderOptions = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    req.signal?.throwIfAborted();
    this.calls.push(req);
    if (this.opts.latencyMs) await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(req.signal?.reason ?? new Error("Aborted")); };
      const timer = setTimeout(() => { req.signal?.removeEventListener("abort", onAbort); resolve(); }, this.opts.latencyMs);
      req.signal?.addEventListener("abort", onAbort, { once: true });
    });
    const text = this.generate(req);
    return { text, model: "fake-1", usage: { inputTokens: req.system.length / 4, outputTokens: text.length / 4 }, stopReason: "end" };
  }

  async stream(req: CompletionRequest, onDelta: (d: string) => void): Promise<CompletionResult> {
    const r = await this.complete(req);
    // Emit in a few chunks to exercise streaming code paths.
    const size = Math.max(8, Math.ceil(r.text.length / 6));
    for (let i = 0; i < r.text.length; i += size) onDelta(r.text.slice(i, i + size));
    return r;
  }

  private generate(req: CompletionRequest): string {
    const scripted = this.opts.scripted?.[req.task];
    if (scripted) return scripted(req);
    switch (req.task) {
      case "npc_opening":
        return this.opening(req);
      case "npc_turn":
        return this.npcTurn(req);
      case "perceive": {
        if (req.system.includes("SCENE_MEANING_V1")) return this.sceneMeaning(req);
        // Reuse the turn heuristics and return only the moves block.
        const m = /<moves>([\s\S]*?)<\/moves>/.exec(this.npcTurn(req));
        return m?.[1] ?? "{}";
      }
      case "evaluate":
        return this.evaluation(req);
      case "extract_memory":
        return this.memory(req);
      case "recommend":
        return JSON.stringify(JSON.parse(req.messages[0].content).candidates?.[0]?.proposal ?? {});
    }
  }

  /** Stable + volatile system text, for the heuristics below. */
  private sceneMeaning(req: CompletionRequest): string {
    // Offline fixture only. Production interpretation is semantic and evidence-grounded.
    const input = JSON.parse(req.messages[0].content) as { playerText: string; features: { id: string }[]; participants: string[] };
    const t = input.playerText;
    const patterns: Record<string, RegExp> = {
      ownership: /my (mistake|responsibility|part)|i (own|committed|promised|should have)|i was wrong|i gave you/i,
      customer_question: /nora.*\?|what.*customer|which.*reports/i,
      capacity_question: /maya.*\?|what.*(verify|capacity|checks)/i,
      customer_care: /keep.*(reports|service|workflow)|existing.*(reports|service)|customer.*continuity/i,
      team_care: /no overtime|protect.*(checks|capacity)|leave.*(verification|rollback)|without.*overtime/i,
      scope_plan: /read.only.*pilot|smaller.*(rollout|pilot)|reduce.*scope|limited.*trial/i,
      delay_plan: /delay.*(rollout|migration)|postpone.*(rollout|release)/i,
      tradeoff: /instead of|give up|cost.*day|dashboard.*wait|trade.*speed/i,
      owner: /i.ll (own|send|coordinate|check|write)|i will (own|send|coordinate|check|write)/i,
      checkpoint: /review.*(tomorrow|noon|monday)|stop if|check.in.*(tomorrow|noon)/i,
      unsupported_promise: /full.*(tonight|today)|everyone.*overtime/i,
      blame: /your fault|not my problem|you people/i,
      repair: /i.ll (send|write|check)|i will (send|write|check)|revised.*plan/i,
      boundary: /no overtime|review.*(tomorrow|noon)|check.in|stop if|limit.*scope/i,
      // V1 encounters (offline fixtures only).
      specific_ask: /stuck on|can you show me|specific(ally)?|one question|exactly where/i,
      did_homework: /i('ve| have) (read|traced|tried)|i read|i traced|i tried/i,
      respects_time: /(ten|10|five|5|fifteen|15) minutes|when you('re| are) free|after your (run|release)|i know you('re| are) busy|your time/i,
      rollback_question: /rollback.*(tested|test|work|triggered|trust)|(tested|test).*rollback|what could go wrong/i,
      gives_back: /i('ll| will) (document|write (it|this) up)|take .* off your plate|your tooling|you built/i,
      dumps_work: /can you (just )?(do|finish|take) (it|this|my)|could you (just )?(do|finish) (it|this)/i,
      need_question: /what (problem|are they trying|happens today)|why do they (want|need)|who uses/i,
      reflects_need: /so (the|their) (real )?(problem|need)|so what they (really )?need|if i understand/i,
      alternative_scope: /(scheduled|faster|nightly|automat\w*) export|refresh before|instead of (a|the) dashboard|smaller (option|fix)/i,
      honest_estimate: /about a quarter|roughly (a|two|three)|not sure yet|depends on|rough estimate/i,
      blind_yes: /(we|i) can (build|deliver|do) (the|a|real.time) dashboard|dashboard (by|in) (friday|two weeks|a week)|yes,? (we|i)('ll| will) build/i,
      dismisses: /not our problem|they don.t need that|just a nice.to.have/i,
      plain_account: /(records|accounts) (failed|didn.t migrate)|date (moved|slipped)|we (missed|shipped|moved)|what happened (is|was)|two different dates/i,
      risk_question: /vikram.*\?|what does (your|the) (team|close)|what (would|matters|hurts) (most|you)|month.end.*\?/i,
      honest_scope: /dashboard (isn.t|is not|won.t be) (coming|ready)|not (going to|coming) (this|next)|won.t have the dashboard/i,
      protection_plan: /(change )?freeze|verified export|manual (fallback|export)|named contact|verify the export/i,
      close_checkpoint: /(on|by) the (28th|twenty.eighth|27th)|go.no.go|check (it|the export) (on|before)/i,
      overpromise: /never happen again|guarantee|dashboard (by|next) (friday|week)/i,
      open_question: /how('s| is) (it|the ticket|it going)|what('s| is) (been )?(hard|blocking|tricky)|what are you stuck/i,
      safety: /i broke|i('ve| have) broken|happens to everyone|i did the same|no one('s| is) (going to|gonna) blame|it('s| is) (okay|fine) to/i,
      his_plan: /what (would|do) you (try|think|do)|what('s| is) your plan|how would you fix/i,
      concrete_support: /pair (with you )?for (an|one) hour|check in (at|with you)|i('ll| will) (sit|pair) with you|ask maya/i,
      takes_over: /i('ll| will) (just )?(do|fix|take) (it|this)|leave it (with|to) me|give it to me/i,
      lecture: /you should have|why didn.t you|you need to learn/i,
      specific_example: /when you (agreed|committed|said)|the friday (deadline|migration)|last (month|sprint) when/i,
      impact: /maya (lost|spent)|(lost|cost) (her|the team|us) (the )?(weekend|evenings)|burn(ed|t)? out/i,
      request: /could you (check|ask)|i('d| would) ask (that )?you|before (you )?commit(ting)?/i,
      acknowledges_pressure: /your director|pressure (you('re| are)|on you)|i know (the|your) (director|pressure)/i,
      offers_help: /i('ll| will) give you (a|better|real) (number|estimate)|my part/i,
      flattery: /nothing (really|at all)|you('re| are) (doing )?(great|fine)|keep doing what/i,
      attack: /you always|you never|everyone (hates|thinks)|you('re| are) (a bad|terrible)/i,
      names_cost: /your weekend|you (spent|lost)|cost you|you warned me/i,
      owns_part: /that('s| was) on me|my (part|fault|mistake)|i caused/i,
      concrete_change: /i('ll| will) ask you before|before i commit|run the rollback (check|test) before/i,
      asks_need: /what do you need|what would help|how can i help/i,
      offers_support: /i('ll| will) (say|tell|speak|back you)|in the (room|meeting) i('ll| will)/i,
      defensive: /rohan (made|wanted)|wasn.t my (call|fault)|i had no choice/i,
      over_apology: /(sorry.*){3,}/i,
      candid: /(went|was) (badly|rough|hard)|i (messed|got .* wrong)|honestly,? (it|the)/i,
      oversell: /(all|everything)('s| has been| is) (great|perfect|amazing)/i,
      curious_ask: /what (do|are) (you|people) (seeing|notice)|what('s| is) (coming|next) (for|at)|how do people grow/i,
      specific_growth: /i('d| would) like to (lead|own|learn)|next i want/i,
      asks_about_her: /how (are|do) you (feel|doing)|what('s| is) (really|actually) (bothering|hard)/i,
      labels_concern: /sounds like (you('re| are)|it('s| is))|you('re| are) worried/i,
      advice_dump: /just (tell|say no|hire)|you should (just )?(tell|say)/i,
      shares_honestly: /my week (was|has been)|honestly,? (work|my job)/i,
      clear_ask: /i('d| would) like to lead|i('m| am) asking for|i want to (lead|own)/i,
      growth_evidence: /(the|in the) crisis|meridian call|when i (owned|mentored|helped arjun)/i,
      support_needed: /i('d| would) need|with (maya|verification) time|review (at the end|in a quarter)|a checkpoint/i,
      takes_feedback: /what (would|does) ready look like|that('s| is) fair|i hear (that|you)/i,
      path_agreed: /(revisit|review) (it )?in a quarter|agreed|let('s| us) (revisit|review)|every friday/i,
      title_grab: /promot(e|ion) me|i deserve (a|the) (title|raise|promotion)|or i('ll| will) leave/i,
    };
    return JSON.stringify({ evidence: input.features.filter((f) => patterns[f.id]?.test(t)).map((f) => ({ feature: f.id, quote: t.slice(0, 500), revoked: false })), addressedTo: input.participants.find((id) => new RegExp(`\\b${id.split("_")[0]}\\b`, "i").test(t)) ?? null });
  }

  private sys(req: CompletionRequest): string {
    return req.systemVolatile ? `${req.system}\n${req.systemVolatile}` : req.system;
  }

  private lastPlayer(req: CompletionRequest): string {
    for (let i = req.messages.length - 1; i >= 0; i--) if (req.messages[i].role === "user") return req.messages[i].content;
    return "";
  }

  private opening(req: CompletionRequest): string {
    // Quest-aware canned openers so UI walkthroughs on the fake provider read sensibly.
    const s = this.sys(req);
    const speech = /first screening call/.test(s)
      ? "Hi, I'm Emma from Nova Labs. Thanks for making time. Tell me a bit about yourself and what you've been working on."
      : /Interviewing .* for the Platform Engineer role/.test(s)
        ? "Rohan. Thanks for coming in. Tell me about a project that went wrong, and what you did."
        : /first day/.test(s)
          ? "Morning! Welcome to Nova Labs. How are you feeling?"
          : /migration in by Friday/.test(s)
            ? "Quick one. I need the migration done by Friday for the release."
            : /owns the database migration/.test(s)
              ? "You wanted a word? What's up?"
              : s.includes("Emma")
                ? "Hi, thanks for making time. I know you've seen the offer, eight and a half lakh base. Where are you at?"
                : "Hi. Good to see you. What's on your mind?";
    return `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}${MOVES_OPEN}{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}${MOVES_CLOSE}`;
  }

  private npcTurn(req: CompletionRequest): string {
    const text = this.lastPlayer(req).toLowerCase();
    if (this.sys(req).includes("CRISIS_READY=")) {
      const ready = this.sys(req).includes("CRISIS_READY=true");
      const speech = ready ? "That plan has an owner and a stopping point. We can work within those limits." : /maya_sen/.test(this.sys(req).split("Your scene goal:")[1] ?? "") ? "I can help within that verification boundary. Who owns the next check?" : `What ${/checkpoint|review/.test(text) ? "would make you stop the rollout" : "will you protect if the full rollout has to wait"}?`;
      return `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}${MOVES_OPEN}{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}${MOVES_CLOSE}`;
    }
    const kitBeat = /NEXT_BEAT: ([^\n]+)/.exec(this.sys(req));
    if (kitBeat && !this.sys(req).includes("CRISIS_READY=")) {
      // Offline fixture: say a quoted line from the authored beat if it has one; otherwise a
      // neutral in-character prompt (never the stage direction itself). Varied so the repeat gate stays quiet.
      const quoted = /['‘"“]([^'’"”]{4,})['’"”]/.exec(kitBeat[1])?.[1];
      const turn = req.messages.filter((m) => m.role === "assistant").length;
      const neutral = ["Go on.", "Okay. Tell me more.", "Right. And then?", "Mm. What else?", "Okay. What would you do next?", "Fair enough. Keep going."];
      const speech = quoted ?? neutral[turn % neutral.length];
      return `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}${MOVES_OPEN}{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}${MOVES_CLOSE}`;
    }
    if (this.sys(req).includes("A separate recovery after")) return `${SPEECH_OPEN}What specific change and check-in can I rely on this time?${SPEECH_CLOSE}${MOVES_OPEN}{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}${MOVES_CLOSE}`;
    if (this.sys(req).includes("AGREEMENT_ALLOWED=")) {
      const ready = this.sys(req).includes("AGREEMENT_ALLOWED=true");
      const question = /\?/.test(text);
      const introduction = /internal lead has only two hours/.test(this.sys(req));
      const speech = ready ? introduction ? "A two-week pilot with a written checkpoint works. I'll make the introduction on that basis." : "That is a plan I can defend. A read-only demonstration Friday, then the rollback test Monday."
        : question ? introduction ? "The lead can give you two hours a week. What could you usefully test in a short pilot?" : "The director needs a safe demonstration Friday. The full migration can wait for the rollback test."
        : "What specific evidence and checkpoint would make that a commitment we can both stand behind?";
      return `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}${MOVES_OPEN}${JSON.stringify({ noticed: [], reveal: question ? ["constraint"] : [], proposal: {}, wantsToEnd: ready })}${MOVES_CLOSE}`;
    }
    const noticed: string[] = [];
    const reveal: string[] = [];
    const proposal: Record<string, number | boolean> = {};
    let speech = "";
    let wantsToEnd = false;

    const hasNumber = /\b(\d+(\.\d+)?)\s*(l|lakh|lakhs|k)\b/.test(text) || /\b\d{5,7}\b/.test(text);
    const aggressive = /(demand|or else|final offer|take it or leave|non-negotiable|unacceptable|insult|waste)/.test(text);
    const evidence = /(offer from|market|benchmark|glassdoor|data|delivered|led|shipped|grew|because i|last year|my current)/.test(text);
    const question = /\?/.test(text) || /(what|how|why|is there|could you|can you)/.test(text);
    const bonus = /(bonus|joining|signing|total comp|equity|stock|esop)/.test(text);
    const minimum = /(minimum|at least|lowest|can't go below|won't accept less)/.test(text);
    const rapport = /(thank|appreciate|excited|love the team|glad)/.test(text);

    // Extract a requested base in lakh.
    const lakhMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:l|lakh|lakhs)\b/);
    const asked = lakhMatch ? Math.round(parseFloat(lakhMatch[1]) * 100000) : null;

    if (aggressive) noticed.push("aggressive_tone");
    if (evidence) noticed.push("evidence_provided");
    if (question) noticed.push("good_question");
    if (bonus) noticed.push("asked_about_total_comp");
    if (minimum) noticed.push("revealed_minimum");
    if (rapport) noticed.push("rapport");
    if (hasNumber) noticed.push("clear_ask");
    if (!text.trim()) noticed.push("silence_or_filler");

    // Parse current offer from the system prompt's director/status lines if present.
    const curMatch = this.sys(req).match(/CURRENT_BASE=(\d+)/);
    const maxMatch = this.sys(req).match(/MAX_BASE=(\d+)/);
    const current = curMatch ? parseInt(curMatch[1], 10) : 850000;
    const max = maxMatch ? parseInt(maxMatch[1], 10) : 970000;

    if (aggressive) {
      speech = "I hear that you're frustrated, but that tone isn't going to move the number. Let's keep this constructive.";
    } else if (bonus) {
      reveal.push("bonus_flexible");
      proposal.signingBonus = 40000;
      speech = "Base is fairly tightly banded for this level. Where I do have some room is a joining bonus — I could look at around forty thousand.";
    } else if (evidence && asked && asked > current) {
      const next = Math.min(max, Math.round((current + Math.min(asked, max)) / 2 / 10000) * 10000);
      proposal.base = next;
      speech = `That's a fair point, and the specifics help. Let me see what I can do — I could take base to ${(next / 100000).toFixed(1)} lakh. That's a genuine stretch.`;
      if (next >= max) reveal.push("base_capped");
    } else if (asked && asked > current) {
      speech = "I understand you're looking for more. Help me understand what's driving that number — I need something concrete to take back to the hiring manager.";
    } else if (question) {
      speech = "Good question. The role sits in the platform team, and they need someone in fast — the current sprint is stretched. What else would help you decide?";
      reveal.push("urgency_high");
    } else if (rapport) {
      speech = "That's lovely to hear, and honestly the team feels the same. So — where are you on the offer?";
    } else {
      speech = "Okay. So where do you stand on the offer as it is?";
    }
    if (/(\baccept|\bdeal\b|let's do it|i'm in|agreed)/.test(text)) {
      wantsToEnd = true;
      speech = "Brilliant. I'll get the revised letter over to you today. Welcome aboard.";
    }
    const moves = { noticed, reveal, proposal, wantsToEnd, patienceDelta: aggressive ? -10 : 0 };
    return `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}\n${MOVES_OPEN}${JSON.stringify(moves)}${MOVES_CLOSE}`;
  }

  private evaluation(req: CompletionRequest): string {
    const rawTranscript = req.messages.map((m) => m.content).join("\n");
    const transcript = rawTranscript.toLowerCase();
    // Quote the player's own words as evidence, like a real evaluator must.
    const playerLines = [...rawTranscript.matchAll(/^\[\d+\] ([^:]+): (.*)$/gm)].filter((m) => !/^(Emma|Rohan|Priya|Nora|Maya|Arjun|Vikram)$/.test(m[1])).map((m) => m[2]);
    const quote = (playerLines[0] ?? "").split(/\s+/).slice(0, 10).join(" ") || "(no player lines)";
    const evidence = /(offer from|market|benchmark|data|delivered|led|shipped)/.test(transcript);
    const aggressive = /(demand|or else|final offer|take it or leave)/.test(transcript);
    const bonus = /(bonus|joining|signing|total comp)/.test(transcript);
    const minimum = /(minimum|at least|lowest)/.test(transcript);
    const criterionIds = [...req.system.matchAll(/criterion id="([^"]+)"/g)].map((m) => m[1]);
    const objectiveIds = [...req.system.matchAll(/objective id="([^"]+)"/g)].map((m) => m[1]);
    // Checked objectives are omitted from evaluation prompts; recognize these fixtures by their rubric.
    if ((criterionIds.includes("responsibility") && criterionIds.includes("interests")) || criterionIds.includes("repair")) {
      const bounded = /review|check.in|stop if/i.test(playerLines.join(" "));
      return JSON.stringify({ summary: bounded ? "You gave the next action a concrete review point. The outcome reflects whether your plan also addressed the people and constraints in the room." : "The next commitment needs a credible limit and a clear account of who will act.", headline: bounded ? "Made the next commitment concrete" : "The plan needs a boundary", overallScore: bounded ? 78 : 35,
        rubricScores: criterionIds.map((id) => ({ criterionId: id, score: bounded ? 3 : 1, evidence: quote, note: "Offline fixture evaluation" })),
        behaviors: [{ skill: "leadership", facet: "direction", score: bounded ? 0.8 : 0.3, evidence: quote }, { skill: "listening", facet: "questioning", score: /\?/.test(playerLines.join()) ? 0.8 : 0.2, evidence: quote }, { skill: "communication", facet: "clarity", score: bounded ? 0.8 : 0.4, evidence: quote }],
        strengths: bounded ? [{ title: "Made the next step checkable", detail: "A review point limits the cost of being wrong." }] : [],
        improvements: [{ title: "Check the room", detail: "Test how the proposal serves both continuity and capacity.", betterMove: "Ask which need is essential, then offer a bounded option that protects it." }], keyMoments: [], objectiveResults: objectiveIds.map((id) => ({ objectiveId: id, achieved: bounded, evidence: quote })) });
    }
    if (req.system.includes("SCENE_KIT")) {
      const lines = playerLines.join(" ");
      const questions = (lines.match(/\?/g) ?? []).length;
      const hostile = /(you always|you never|not our problem|your fault|promote me|or i('ll| will) leave)/i.test(lines);
      const good = questions >= 1 && !hostile && playerLines.length >= 2;
      const score = good ? 0.75 : hostile ? 0.25 : 0.45;
      return JSON.stringify({
        summary: good ? "You asked before you answered, and the conversation moved because of it. Keep making the next step concrete." : "The conversation stayed on the surface. One more genuine question would have changed what you learned.",
        headline: good ? "Asked first, then moved" : "Stayed on the surface",
        overallScore: good ? 74 : hostile ? 30 : 46,
        rubricScores: criterionIds.map((id) => ({ criterionId: id, score: good ? 3 : 1, evidence: quote, note: "Offline fixture evaluation" })),
        behaviors: [
          { skill: "listening", facet: "questioning", score: questions >= 1 ? 0.75 : 0.3, evidence: quote },
          { skill: "communication", facet: "clarity", score, evidence: quote },
          { skill: "conflict_resolution", facet: "empathy", score: hostile ? 0.2 : score, evidence: quote },
        ],
        strengths: good ? [{ title: "Asked before advising", detail: "Your question surfaced what actually mattered to them." }] : [],
        improvements: [{ title: good ? "Close with a concrete next step" : "Ask one more question", detail: good ? "Name who does what, and when you'll check." : "The hidden part of the problem only comes out when you ask for it.", betterMove: good ? "Finish with: 'So I'll do X by Y, and we'll check on Z.'" : "Ask: 'What's the part that's actually hard?'" }],
        keyMoments: [], objectiveResults: objectiveIds.map((id) => ({ objectiveId: id, achieved: good, evidence: quote })),
      });
    }
    if (objectiveIds.includes("ground_plan")) {
      const bounded = /\b(pilot|read.only|narrower)\b/.test(transcript) && /\b(checkpoint|rollback|review)\b/.test(transcript);
      return JSON.stringify({
        summary: bounded ? "You moved the conversation toward a bounded next step. Check that the other person's constraint is reflected in the proposal, not just mentioned." : "Your position needs a more concrete next step: what scope, what evidence, and when you will check it.",
        headline: bounded ? "A smaller plan someone can stand behind" : "The next step still needs a shape",
        overallScore: bounded ? 72 : 38,
        rubricScores: criterionIds.map((id) => ({ criterionId: id, score: bounded ? 3 : 1, evidence: quote, note: "Local simulated feedback" })),
        behaviors: [
          { skill: "listening", facet: "questioning", score: /\?/.test(transcript) ? 0.75 : 0.3, evidence: quote },
          { skill: "negotiation", facet: "proposing_alternatives", score: bounded ? 0.75 : 0.3, evidence: quote },
          { skill: "persuasion", facet: "evidence", score: evidence ? 0.8 : 0.3, evidence: quote },
        ],
        strengths: bounded ? [{ title: "Bounded the commitment", detail: "A smaller next step gives the other person something concrete to consider." }] : [],
        improvements: [{ title: "Check the fit", detail: "Make sure the proposed scope answers the actual constraint.", betterMove: "Ask what would make this a useful trial, then confirm the scope and review point." }],
        keyMoments: [], objectiveResults: objectiveIds.map((id) => ({ objectiveId: id, achieved: bounded, evidence: quote })),
      });
    }
    const score = (b: boolean, hi: number, lo: number) => (b ? hi : lo);
    return JSON.stringify({
      summary: evidence
        ? "You justified your counter with specifics and kept the tone collaborative, which is why the recruiter moved. You could have explored the total package earlier."
        : "You asked for more but did not give the recruiter anything concrete to take back, so the offer barely moved. Anchor with a specific number and a reason.",
      headline: evidence ? "Justified the number, kept the room" : "Asked without a reason",
      overallScore: 40 + (evidence ? 25 : 0) + (bonus ? 10 : 0) - (aggressive ? 15 : 0) - (minimum ? 10 : 0),
      rubricScores: criterionIds.map((id) => ({ criterionId: id, score: evidence ? 3 : 1, evidence: "(fake) transcript", note: "(fake)" })),
      behaviors: [
        { skill: "negotiation", facet: "anchoring", score: score(/\d+\s*(l|lakh)/.test(transcript), 0.8, 0.3), evidence: quote, note: "" },
        { skill: "persuasion", facet: "evidence", score: score(evidence, 0.85, 0.25), evidence: quote, note: "" },
        { skill: "negotiation", facet: "discovery", score: score(bonus, 0.75, 0.35), evidence: quote },
        { skill: "negotiation", facet: "protecting_leverage", score: score(!minimum, 0.7, 0.15), evidence: quote },
        { skill: "negotiation", facet: "maintaining_rapport", score: score(!aggressive, 0.75, 0.2), evidence: quote },
        { skill: "confidence", facet: "assertiveness", score: 0.65, evidence: quote },
        { skill: "communication", facet: "clarity", score: 0.6, evidence: quote },
      ],
      strengths: evidence ? [{ title: "Justified the counter with evidence", detail: "You tied the number to concrete results, which gave the recruiter something to defend internally." }] : [],
      improvements: [
        {
          title: bonus ? "Push discovery earlier" : "Explore total compensation",
          detail: "Base was capped; the flexible lever was the joining bonus.",
          betterMove: "Ask early: 'Beyond base, what does the total package look like — joining bonus, variable, equity?'",
        },
      ],
      keyMoments: [{ turnIndex: 1, label: "Opening counter", impact: evidence ? "positive" : "neutral", detail: "(fake)" }],
      objectiveResults: objectiveIds.map((id) => ({ objectiveId: id, achieved: evidence, evidence: quote })),
    });
  }

  private memory(req: CompletionRequest): string {
    if (this.sys(req).includes('"_evidence"')) {
      const name = /memory of ([^(]+)/.exec(req.system)?.[1]?.trim() ?? "The participant";
      const scenario = /Scenario: ([^.]+)\./.exec(req.system)?.[1]?.trim();
      if (scenario && !/Project Crisis/.test(scenario)) return JSON.stringify({ facts: [], beliefs: [], commitments: [], events: [{ summary: `We talked: ${scenario}.`, importance: 0.6, emotionalTone: "mixed" }], interactionSummary: `${name}: I remember our conversation, ${scenario}.` });
      return JSON.stringify({ facts: [], beliefs: [], commitments: [], events: [{ summary: `${name} witnessed the player's proposed plan and its limits.`, importance: 0.6, emotionalTone: "mixed" }], interactionSummary: `${name}: I remember what they took responsibility for in the meeting.` });
    }
    if (req.system.includes('"evidenceFacts"')) {
      const ready = req.system.includes('"ready":true');
      return JSON.stringify({ facts: [], beliefs: [], commitments: [], events: [{ summary: ready ? "We found a bounded next step I could stand behind." : "We talked about a next step, but did not reach a credible plan.", importance: 0.8, emotionalTone: ready ? "positive" : "mixed" }], interactionSummary: ready ? "A concrete proposal, with a limit on what they would take on." : "The plan still needed more shape before I could agree." });
    }
    const transcript = req.messages.map((m) => m.content).join("\n").toLowerCase();
    const evidence = /(offer from|market|benchmark|data|delivered|led|shipped)/.test(transcript);
    const aggressive = /(demand|or else|final offer|take it or leave)/.test(transcript);
    return JSON.stringify({
      facts: [{ key: "player.negotiated_offer", statement: "Negotiated their Nova Labs offer with me.", confidence: 0.95 }],
      beliefs: [
        aggressive
          ? { key: "pushy", statement: "Pushes hard and can get aggressive when they don't get their way.", valence: -0.6, strength: 0.7, evidence: "(fake)" }
          : { key: "prepared", statement: evidence ? "Comes prepared with specifics." : "Asks for more without much justification.", valence: evidence ? 0.7 : -0.2, strength: 0.6, evidence: "(fake)" },
      ],
      events: [{ summary: "We negotiated the Nova Labs offer.", importance: 0.8, emotionalTone: aggressive ? "negative" : "positive" }],
      commitments: [{ by: "npc", description: "Send the revised offer letter today.", dueBy: null }],
      interactionSummary: aggressive ? "A tense negotiation; they pushed hard." : "A constructive negotiation over the Nova Labs offer.",
    });
  }
}
