/** Two authored encounter grammars; the Director assembles a player's version. */
import { defineQuest, type AnyQuestDefinition } from "@/engine/types/quest";
import type { DirectorProposal, EncounterVariant } from "@/engine/director/types";
import type { Consequence } from "@/engine/types/consequences";
import type { SkillId } from "@/engine/types/skills";
import { correctedPortion } from "@/engine/parsing/player";
import { textSimilarity } from "@/engine/util";
import { bossDirection, SPONSORSHIP_BOSS } from "@/engine/scene/boss";

export const ENCOUNTER_IDS = ["director_checkpoint", "director_introduction"] as const;
export const VARIANT_SKILLS: Record<EncounterVariant, SkillId[]> = {
  repair: ["conflict_resolution", "negotiation", "communication"],
  listen: ["listening", "conflict_resolution", "leadership"],
  ask: ["confidence", "persuasion", "listening"],
  stretch: ["leadership", "negotiation", "persuasion", "listening"],
};
export const VARIANT_FOCUS: Record<EncounterVariant, string> = {
  repair: "Explain the risk, hold a realistic boundary, and offer a workable alternative.",
  listen: "Find out what the other person needs before defending your own position.",
  ask: "Name what you want, then make a specific, credible case for it.",
  stretch: "Discover the constraint, trade scope for certainty, and agree how success will be checked.",
};
interface Hidden extends Record<string, unknown> {
  variant: EncounterVariant; boss: boolean; beforeIncident: boolean; trust: number;
  evidenceRequired: number; constraint: string; pressure: string;
}
interface Progress extends Record<string, unknown> {
  evidenceFacts: string[];
  asked: boolean; discovered: boolean; acknowledged: boolean; evidence: number;
  alternative: boolean; bounded: boolean; hostile: boolean; ready: boolean;
}

export function createDirectorEncounter(id: string, proposal?: DirectorProposal): AnyQuestDefinition {
  const introduction = id === "director_introduction";
  const variant = proposal?.variant ?? "repair";
  const boss = proposal?.eventType === "boss";
  const npcId = introduction ? "emma_kapoor" : "rohan_mehta";
  const skills = proposal?.targetSkills ?? VARIANT_SKILLS[variant];
  const title = proposal?.title ?? (introduction ? "A Door Emma Can Open" : "The Next Commitment");
  const success = (c: Progress) => c.ready && !c.hostile;
  return defineQuest<Hidden, Progress>({
    ...(boss ? { boss: SPONSORSHIP_BOSS } : {}),
    id, title,
    pacing: { category: boss ? "boss" : introduction ? "relationship" : "consequence", intensity: (proposal?.difficulty ?? 2) as 1 | 2 | 3 | 4 | 5, emotionalPressure: boss ? 4 : 2, importance: boss ? 4 : 3, urgency: introduction ? "optional" : "consequence" },
    tagline: proposal?.summary ?? (introduction ? "Emma is willing to hear your case. Her reputation is on the line too." : "Rohan needs a commitment he can defend. What will you put your name to?"),
    worldId: "career_city", locationId: introduction ? "career_city.nova_labs_hr" : "career_city.nova_labs_platform",
    npcId, difficulty: (proposal?.difficulty ?? 2) as 1 | 2 | 3 | 4 | 5,
    skills, order: introduction ? 80 : 70,
    prerequisites: [
      { type: "world_unlocked_quest", questId: id },
      { type: "career_status", status: "employed" },
    ],
    briefing: {
      situation: proposal?.summary ?? "This conversation becomes available when something in your story gives it a reason to happen.",
      objective: VARIANT_FOCUS[variant],
      intel: introduction
        ? ["Emma can offer an introduction or a smaller internal trial. Neither guarantees a promotion.", "She needs to protect the credibility of her recommendation."]
        : ["Rohan needs something concrete to tell his director.", "You can propose a narrower delivery or negotiate more time. An unsupported promise will not help."],
    },
    carryOver: () => proposal ? [proposal.whyNow, ...proposal.history.filter((h) => h.kind !== "skill").map((h) => h.label).slice(0, 3)] : [],
    objectives: [
      { id: "make_ask", label: "State your position", kind: "primary", description: "Make a direct request or state a realistic delivery boundary.", check: (s) => (s.custom as Progress).asked },
      { id: "discover", label: "Uncover the real constraint", kind: "hidden", description: "Ask about their constraint before proposing the final plan.", check: (s) => (s.custom as Progress).discovered },
      { id: "ground_plan", label: "Agree a credible next step", kind: "primary", description: "Support a bounded plan with evidence or a discovered trade-off.", check: (s) => success(s.custom as Progress) },
      { id: "preserve_relationship", label: "Leave room to work together", kind: "hidden", description: "Acknowledge the other person's stakes without threats.", check: (s) => (s.custom as Progress).acknowledged && !(s.custom as Progress).hostile },
    ],
    scene: {
      createHidden: ({ world, npc }) => ({
        variant, boss, trust: npc.relationship.trust,
        beforeIncident: !world.flags.includes("chapter1.complete"),
        evidenceRequired: npc.relationship.trust < 0 || world.director.reputation.reliable < -10 || boss ? 2 : 1,
        constraint: introduction
          ? "The internal lead has only two hours a week to support a trial. A two-week pilot with a written checkpoint is possible; a full transfer or promotion is outside your authority."
          : "The director needs a safe demonstration, not a complete migration. A read-only Friday demonstration plus a Monday rollback test is acceptable. Do not offer shipping without rollback.",
        pressure: introduction ? "Your introduction puts your credibility on the line." : "You have to explain the commitment to your own director.",
      }),
      createCustom: () => ({ evidenceFacts: [], asked: false, discovered: false, acknowledged: false, evidence: 0, alternative: false, bounded: false, hostile: false, ready: false }),
      initialPatience: ({ hidden, npc }) => (hidden.boss ? 48 : 66) + Math.round(npc.relationship.trust / 8) + Math.round(npc.relationship.warmth / 12),
      opening: { scripted: ({ hidden }) => introduction
        ? hidden.trust >= 20 ? "I remember how you handled the offer. There's someone I could introduce you to. What would you want from that conversation?" : "You wanted to talk about what's next. Before I put your name forward, what exactly are you asking for?"
        : hidden.beforeIncident ? "Before I repeat that date to my director, talk me through what we're actually committing to." : "After the migration, I want us to agree how the next commitment gets made. What would you change?" },
      npcSituation: ({ hidden, playerName }) => `${playerName} has come back to you after the Nova Labs migration decision. ${hidden.pressure} Focus: ${VARIANT_FOCUS[variant]}`,
      hiddenBriefing: ({ hidden, scene }) => `${hidden.constraint}\n${hidden.trust < 0 ? "Trust is strained: ask for a second concrete example or a smaller reversible trial." : "Trust buys a fair hearing, never an automatic yes."}\n${hidden.boss ? "This is a consequential decision. Challenge both the evidence and the capacity assumption, one question at a time. Be realistic, never hostile for its own sake." : "Let a thoughtful question uncover room to work together."}\nAGREEMENT_ALLOWED=${scene.custom.ready}. Only agree a next step when true. Never invent a promotion, salary change or guaranteed transfer.`,
      revealableKeys: { constraint: "After a relevant question about priorities, capacity or what would make the plan work." },
      preTurn: ({ scene, hidden }, read, text) => {
        const c = { ...scene.custom };
        const t = correctedPortion(text).toLowerCase().replace(/[’‘]/g, "'");
        const negated = /\b(i (?:won't|will not|can't|cannot|don't|do not)|no need to)\b/.test(t);
        if (/\b(?:i (?:withdraw|take back)|forget|cancel|scrap) (?:that|the|my|this)\b/.test(t) || (negated && /\b(pilot|trial|demonstration|checkpoint|rollback|plan|introduction)\b/.test(t))) {
          c.asked = false; c.alternative = false; c.bounded = false; c.ready = false;
        }
        const specificQuestion = /\b(what|how|which|why)\b.*\b(need|matter|constraint|priority|priorities|capacity|concern|work|risk|success|friday|support)\b/.test(t);
        if (specificQuestion && read.signals.includes("good_question")) c.discovered = true;
        if (read.signals.some((s) => s === "empathy" || s === "acknowledged_npc") && /\b(director|credibility|time|pressure|risk|concern|capacity|reputation|support)\b/.test(t)) c.acknowledged = true;
        if (!negated && /\b(i (?:would like|want|propose|suggest|need)|could (?:you|we)|can (?:you|we)|let's|my (?:ask|proposal) is)\b/.test(t)) c.asked = true;
        // A concrete risk explanation also supports a plan; bare numbers or keywords do not.
        if (!negated && !c.evidenceFacts.some((fact) => textSimilarity(fact, t) >= 0.8) && (read.signals.includes("evidence_provided") || /\b(without|missing|failed|untested)\b.{0,45}\b(rollback|test|backup)\b|\b(rollback|test|backup)\b.{0,45}\b(missing|untested|failed)\b/.test(t))) {
          c.evidenceFacts = [...c.evidenceFacts, t].slice(0, 2);
          c.evidence = c.evidenceFacts.length;
        }
        const scope = introduction ? /\b(pilot|trial)\b/.test(t) : /\b(read.only|demonstration|narrower|reduce.{0,15}scope)\b/.test(t);
        if (!negated && scope) c.alternative = true;
        const boundedPlan = introduction ? /\b(two.week|2.week|(?:two|2) weeks)\b/.test(t) && /\b(checkpoint|review|check.in)\b/.test(t)
          : /\bfriday\b/.test(t) && /\bmonday\b/.test(t) && /\b(rollback|test)\b/.test(t);
        if (!negated && boundedPlan) c.bounded = true;
        if (read.signals.some((s) => s === "aggressive_tone" || s === "ultimatum")) c.hostile = true;
        // Two viable strategies: evidence-led case, or discovery plus a smaller reversible trial.
        const evidencePath = c.evidence >= hidden.evidenceRequired && c.alternative;
        const discoveryPath = c.discovered && c.acknowledged && c.alternative && c.evidence >= 1;
        const focusMet = variant === "listen" ? c.discovered && c.acknowledged : variant === "stretch" ? c.discovered && c.evidence >= hidden.evidenceRequired : true;
        c.ready = c.asked && c.bounded && focusMet && (evidencePath || discoveryPath) && !c.hostile;
        return { custom: c, direction: [
          specificQuestion ? `Answer the actual constraint briefly: ${hidden.constraint}` : "",
          c.ready ? "A credible bounded next step is now allowed. Agree only the pilot or safe delivery plan, never a promotion or reward." : "No agreement yet. Ask for the missing part of a credible commitment; one question only.",
        ].filter(Boolean) };
      },
      speechGate: (sentence, { scene }) => {
        if (/\b(you(?:'re| are) promoted|guarantee.{0,25}(promotion|transfer)|salary (?:is now|will be))/i.test(sentence)) return { ok: false, reason: "outside_encounter_authority", rewrite: "I can discuss a next step, but I can't promise a promotion or a transfer." };
        if (!scene.custom.ready && /\b(agreed|it's a deal|we have a deal|i'll (?:make the introduction|introduce you)|consider it done)\b/i.test(sentence)) return { ok: false, reason: "agreement_before_objectives", rewrite: "Before I agree, I need a concrete plan I can stand behind." };
        return { ok: true };
      },
      director: ({ scene, hidden }) => [
        ...(boss ? [bossDirection(SPONSORSHIP_BOSS, scene.custom)] : []),
        !scene.custom.discovered ? "Do not dump your hidden constraint. Give them space to ask." : "They asked about your constraint; answer it honestly.",
        hidden.trust < 0 ? "A smaller pilot can rebuild trust. Warm words alone cannot." : "Recognize a workable trade-off when they offer one.",
        scene.turnCount >= 6 ? "Bring this to a decision. An unsupported plan can end with a clear no and a reason." : "",
      ].filter(Boolean),
      visibleStatus: ({ scene }) => [{ label: "Next step", value: scene.custom.ready ? "A bounded plan is on the table" : "Still being discussed" }],
      minTurns: 2, maxTurns: boss ? 10 : 8,
    },
    rubric: [
      { id: "position", skill: "confidence", facet: "assertiveness", label: "A clear position", description: "A direct ask or realistic boundary, not an apology spiral.", anchors: { exemplary: "Named the ask and held it calmly.", weak: "Never made an ask." }, weight: 1 },
      { id: "discovery", skill: "listening", facet: "questioning", label: "The question that changed the plan", description: "Uncovered the actual constraint and used it.", anchors: { exemplary: "Changed the proposal after hearing the constraint.", weak: "Kept arguing without asking." }, weight: variant === "listen" ? 1.5 : 1 },
      { id: "options", skill: "negotiation", facet: "proposing_alternatives", label: "A workable alternative", description: "A smaller safe delivery or reversible pilot with a checkpoint.", anchors: { exemplary: "Bounded scope, evidence and a date.", weak: "Another unsupported promise." }, weight: 1.3 },
      { id: "evidence", skill: "persuasion", facet: "evidence", label: "A credible case", description: "Specific relevant results or a clear risk explanation.", anchors: { exemplary: "Evidence survives a follow-up question.", weak: "Unverifiable claims or bare numbers." }, weight: 1 },
    ],
    evaluatorNotes: "Judge only spoken player evidence. The deterministic objectives are authoritative. No promotion or job is awarded here. Do not mistake politeness for listening or a number for evidence.",
    outcomes: [
      {
        id: "credible_plan", label: introduction ? "An introduction, with a purpose" : "A commitment you can defend", grade: "success",
        when: ({ scene }) => success(scene.custom),
        narrative: () => introduction ? "Emma agrees to introduce you for a bounded internal pilot. She can explain why you are worth the time, and what you will ask for." : "Rohan has a smaller, safer plan to take upstairs. You held a boundary without leaving him empty-handed.",
        consequences: ({ hidden, world }) => {
          const out: Consequence[] = [
            { type: "relationship.delta", npcId, delta: { trust: 8, respect: 7, warmth: 2, familiarity: 5 } },
            { type: "world.decision.add", description: introduction ? "Made a credible case to Emma for a bounded internal pilot." : "Replaced an unsupported commitment with a bounded, evidence-backed plan." },
            { type: "world.flag.add", flag: introduction ? "director.introduction_earned" : "director.checkpoint_resolved" },
          ];
          if (introduction) out.push({ type: "world.opportunity.add", description: "Emma will introduce you for a two-week internal pilot with a written checkpoint.", sourceNpcId: npcId, questId: null });
          else if (hidden.beforeIncident) {
            out.push({ type: "world.flag.add", flag: "director.deadline_replanned" });
            for (const c of world.commitments.filter((x) => x.toNpcId === npcId && x.madeInQuestId === "push_back_on_deadline" && x.status === "open")) out.push({ type: "world.commitment.resolve", commitmentId: c.id, status: "superseded" });
            out.push({ type: "world.commitment.add", description: "Read-only demonstration Friday; full migration after Monday's rollback test.", toNpcId: npcId, dueBy: null });
          }
          return out;
        },
        aftermath: ({ hidden }) => [introduction ? "Emma has put her name behind a specific next step. The opportunity is real; the promotion is not promised." : hidden.beforeIncident ? "The rollback test stays in the plan. The status update will remember this correction." : "Rohan will expect the same specificity in the next commitment."],
        rewardMultiplier: boss ? 1.35 : 1.15,
      },
      {
        id: "not_yet", label: "No agreement yet", grade: "failure", when: () => true,
        narrative: () => introduction ? "Emma keeps the introduction on hold. She needs a clearer ask and a plan she can recommend without making promises for you." : "Rohan leaves without a revised commitment. The earlier decision still stands, and so does its risk.",
        consequences: () => [
          { type: "relationship.delta", npcId, delta: { trust: -4, respect: -3, familiarity: 4 } },
          { type: "world.decision.add", description: introduction ? "Emma held back an introduction because the plan was not yet credible." : "The commitment checkpoint ended without a revised plan." },
        ],
        aftermath: () => ["You can rehearse a different approach. This meeting remains part of the story."], rewardMultiplier: 0.65,
      },
    ],
    rewards: { baseXp: boss ? 110 : 80, skills: Object.fromEntries(skills.map((skill) => [skill, 1 / skills.length])) },
  });
}
