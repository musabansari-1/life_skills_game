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
    this.calls.push(req);
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
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
        // Reuse the turn heuristics and return only the moves block.
        const m = /<moves>([\s\S]*?)<\/moves>/.exec(this.npcTurn(req));
        return m?.[1] ?? "{}";
      }
      case "evaluate":
        return this.evaluation(req);
      case "extract_memory":
        return this.memory(req);
      case "recommend":
        return JSON.stringify({ questIds: [], reason: "fake" });
    }
  }

  /** Stable + volatile system text, for the heuristics below. */
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
    const playerLines = [...rawTranscript.matchAll(/^\[\d+\] ([^:]+): (.*)$/gm)].filter((m) => !/^(Emma|Rohan|Priya)$/.test(m[1])).map((m) => m[2]);
    const quote = (playerLines[0] ?? "").split(/\s+/).slice(0, 10).join(" ") || "(no player lines)";
    const evidence = /(offer from|market|benchmark|data|delivered|led|shipped)/.test(transcript);
    const aggressive = /(demand|or else|final offer|take it or leave)/.test(transcript);
    const bonus = /(bonus|joining|signing|total comp)/.test(transcript);
    const minimum = /(minimum|at least|lowest)/.test(transcript);
    const criterionIds = [...req.system.matchAll(/criterion id="([^"]+)"/g)].map((m) => m[1]);
    const objectiveIds = [...req.system.matchAll(/objective id="([^"]+)"/g)].map((m) => m[1]);
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
