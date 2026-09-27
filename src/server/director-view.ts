import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { planDirector } from "@/engine/director";
import { reconcileThreads } from "@/engine/director/continuity";
import { SKILLS, type SkillId } from "@/engine/types/skills";
import type { NarrativeView } from "@/contracts/api";
import type { PlayerState } from "./player";

const TECHNIQUES: { id: string; title: string; skill: SkillId; facet: string; hint: string }[] = [
  { id: "clarify", title: "The clarifying question", skill: "listening", facet: "questioning", hint: "Ask what has to be true for the other person's plan to work. Nora's real need and Arjun's broken staging both came out this way." },
  { id: "label", title: "Label the concern", skill: "listening", facet: "acknowledgement", hint: "Say the worry you hear, in your words: 'Sounds like it's less about the job and more about family.'" },
  { id: "summarize", title: "Summarise and confirm", skill: "listening", facet: "building_on", hint: "Play back what you heard before you propose: 'So the real problem is the month-end export?'" },
  { id: "silence", title: "Strategic silence", skill: "listening", facet: "reading_signals", hint: "When someone says 'it's fine', wait a beat. The real answer often comes next." },
  { id: "anchor", title: "Anchoring", skill: "negotiation", facet: "anchoring", hint: "Name your number first, and give it a reason." },
  { id: "alternatives", title: "Offer alternatives", skill: "negotiation", facet: "proposing_alternatives", hint: "Keep the underlying need, change the scope or timing: a read-only pilot, a verified export." },
  { id: "evidence", title: "Evidence first", skill: "persuasion", facet: "evidence", hint: "Start with one relevant result and explain what it supports." },
  { id: "reframe", title: "Reframing", skill: "persuasion", facet: "framing", hint: "Put your ask in terms of what they care about: the customer's Monday, the director's date." },
];

/** Explicit projection: hidden objectives, constraint text and model/debug metadata stay server-side. */
export function narrativeView(state: PlayerState): NarrativeView {
  const world = reconcileThreads(state);
  const stored = world.director.recommended;
  const p = stored ?? planDirector({ ...state, world }).selected;
  const approved = !!stored && (stored.template === "curated" || world.director.offers.some((o) => o.id === stored.id));
  const rep = world.director.reputation;
  const labels: Record<keyof typeof rep, [string, string]> = {
    reliable: ["People can plan around your word", "Your commitments are being checked"],
    assertive: ["You are making clearer asks", "You are still finding your voice"],
    diplomatic: ["You can disagree and keep the room", "People are bracing for pushback"],
    credible: ["Your specifics are building credibility", "Claims need more support"],
    empathetic: ["People feel heard by you", "Some concerns are going unheard"],
  };
  return {
    recommendation: p ? { questId: p.questId, title: p.title, summary: p.summary, whyNow: p.whyNow, npcName: NPCS[p.npcId]?.shortName ?? "", eventType: p.eventType, difficulty: p.difficulty, focus: p.targetSkills.map((s) => SKILLS[s].label), history: p.history.map((h) => h.label), approved: approved || p.template === "curated" } : null,
    preferences: world.director.preferences,
    threads: world.director.threads.map((t) => ({ id: t.id, title: t.title, status: t.status, stage: t.stage, explanation: t.explanation, sourceAttemptId: t.sourceAttemptId, sourceTitle: findQuest(t.sourceQuestId)?.title ?? t.sourceQuestId, resolution: t.resolution })),
    reputation: Object.entries(rep).filter(([, n]) => Math.abs(n) >= 6).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2).map(([k, n]) => labels[k as keyof typeof rep][n >= 0 ? 0 : 1]),
    techniques: TECHNIQUES.map((t) => {
      const facet = state.competencies[t.skill].facets[t.facet];
      const discovered = state.competencies[t.skill].discovered.includes(t.facet);
      return { id: t.id, title: t.title, hint: t.hint, stage: facet?.samples >= 4 && facet.estimate >= 65 ? "reliable" as const : discovered ? "discovered" as const : "learning" as const };
    }),
  };
}
