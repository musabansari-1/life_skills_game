/**
 * Career City ending prose. Pure tables keyed by authoritative state (flags,
 * milestone outcomes, relationships). `resolveEnding` in engine/campaign picks
 * from these; nothing here is written by a model and nothing is flattering
 * without the state that earns it.
 */
import type { NPCInstanceState } from "@/engine/types/npc";
import type { WorldState } from "@/engine/types/world";
import { formatINR } from "@/engine/util";

export interface MomentRule {
  /** Where the moment happened (its attempt links the debrief). */
  questId: string;
  /** Higher = more likely to make the final seven. */
  weight: number;
  label: (world: WorldState) => string | null;
}

const outcome = (w: WorldState, questId: string) => w.campaign.milestones[questId]?.outcomeId ?? [...w.completedQuests, ...w.failedQuests].filter((r) => r.questId === questId).at(-1)?.outcomeId ?? null;
const has = (w: WorldState, flag: string) => w.flags.includes(flag);

/** In story order. Each rule reads one real decision and returns null when it didn't happen. */
export const MOMENTS: MomentRule[] = [
  { questId: "counter_offer", weight: 9, label: (w) => {
    const o = outcome(w, "counter_offer");
    if (!o) return null;
    if (o === "walked_away") return w.campaign.failures.some((f) => f.questId === "counter_offer" && f.recoveredBy) ? "Lost the Nova Labs offer by pushing too hard, then won it back at the original terms" : "Pushed Emma until she withdrew the offer";
    const base = w.career.baseSalary, bonus = w.career.signingBonus;
    if (o === "took_first_offer") return `Accepted the first offer at ${formatINR(base ?? 850000)} without a question`;
    if (base && base > 850000) return `Negotiated the offer from ₹8.5L to ${formatINR(base)}${bonus ? ` plus a ${formatINR(bonus)} joining bonus` : ""}${o === "hardball_deal" ? ", and bruised Emma doing it" : ""}`;
    return bonus ? `Held the base at ₹8.5L but found a ${formatINR(bonus)} joining bonus` : "Joined Nova Labs at the offered terms";
  } },
  { questId: "meet_maya", weight: 4, label: (w) => has(w, "maya.collaborator") ? "Asked Maya for help the right way, and learned the rollback had never run on real data" : has(w, "maya.distant") ? "Asked Maya to do your homework on day three" : null },
  { questId: "push_back_on_deadline", weight: 8, label: (w) => has(w, "nova_labs.rushed_migration") ? has(w, "director.deadline_replanned") ? "Agreed to Friday, then went back to Rohan and replanned it" : "Promised Rohan Friday without a rollback path" : outcome(w, "push_back_on_deadline") === "plan_agreed" ? "Told Rohan Friday wasn't safe, and offered him something that was" : outcome(w, "push_back_on_deadline") === "stalemate" ? "Left the deadline conversation without a date anyone owned" : null },
  { questId: "nora_requirements", weight: 5, label: (w) => has(w, "nora.real_need_found") ? "Asked what Meridian actually needed, instead of estimating what they asked for" : has(w, "nora.dashboard_promised") ? "Promised Nora a real-time dashboard nobody had scoped" : null },
  { questId: "status_update", weight: 8, label: (w) => has(w, "chapter1.owned_incident") ? has(w, "nova_labs.rushed_migration") ? "Walked into Rohan's office and owned the production incident" : "Told Rohan about the slip before he had to ask" : has(w, "chapter1.hid_incident") ? "Told Rohan the incident was minor. He found out it wasn't." : null },
  { questId: "maya_checkin", weight: 5, label: (w) => has(w, "maya.repaired") ? "Sat with Maya's frustration and changed how you commit her time" : has(w, "maya.ally") ? "Backed Maya's rollback rule in front of the team" : has(w, "maya.closed") ? "Maya stopped offering help after your conversation" : null },
  { questId: "customer_escalation", weight: 7, label: (w) => has(w, "meridian.trust_restored") ? "Gave Meridian a straight answer and protected their month-end close" : has(w, "meridian.nora_owns") ? "Lost the Meridian call; Nora took the account back" : has(w, "meridian.watching") ? "Kept Meridian on the line, but on watch" : null },
  { questId: "director_introduction", weight: 4, label: (w) => has(w, "director.introduction_earned") ? "Earned Emma's introduction for a bounded internal pilot" : null },
  { questId: "mentor_arjun", weight: 5, label: (w) => has(w, "arjun.mentored") ? "Helped Arjun admit he'd broken staging, and let him fix it himself" : has(w, "arjun.dependent") ? "Fixed Arjun's problem for him instead of with him" : has(w, "arjun.hiding") ? "Missed that Arjun was hiding a broken staging environment" : null },
  { questId: "feedback_for_rohan", weight: 5, label: (w) => has(w, "rohan.took_feedback") ? "Told Rohan, kindly and specifically, that he volunteers the team's evenings" : has(w, "rohan.feedback_bruised") ? "Gave Rohan feedback that landed as an attack" : has(w, "rohan.no_feedback") ? "Told Rohan there was nothing he should change" : null },
  { questId: "project_crisis", weight: 10, label: (w) => {
    const o = outcome(w, "project_crisis");
    return o === "aligned_recovery" ? "Found a plan Rohan, Nora and Maya could all stand behind in the crisis room" : o === "contained_with_oversight" ? "Contained the Project Crisis, with Rohan watching" : o === "manager_takes_over" ? "Lost the Project Crisis room; Rohan took the rollout back" : null;
  } },
  { questId: "the_review", weight: 9, label: (w) => has(w, "review.lead_trial") ? "Asked for the lead role with a real case, and got a one-quarter trial" : has(w, "review.path_agreed") ? "Heard 'not yet' without flinching, and agreed what ready looks like" : has(w, "review.rebuild_agreed") ? "Owned the crisis in your review and agreed a way back" : has(w, "review.stalled") ? "Left your review without a clear next step" : null },
  // Optional scenes: they belong in the recap even when they don't make the final seven.
  { questId: "director_checkpoint", weight: 3, label: (w) => has(w, "director.checkpoint_resolved") ? "Went back to Rohan and made the next commitment defensible" : null },
  { questId: "emma_check_in", weight: 2, label: (w) => has(w, "emma.knows_ambition") ? "Told Emma the truth at ninety days, and heard the lead role was coming" : null },
  { questId: "priya_interlude", weight: 1, label: (w) => has(w, "priya.confidant") ? "Listened to Priya instead of fixing her problem" : null },
];

export interface StoryMoment { questId: string; label: string; attemptId: string | null; at: string; weight: number }
/** Every meaningful moment that actually happened, oldest first. Repairs included; raw state never. */
export function storyMoments(world: WorldState): StoryMoment[] {
  const records = [...world.completedQuests, ...world.failedQuests];
  const last = (questId: string) => records.filter((r) => r.questId === questId).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const moments: StoryMoment[] = [];
  for (const m of MOMENTS) {
    let label: string | null = null;
    try { label = m.label(world); } catch { label = null; }
    const rec = last(m.questId);
    if (label && rec) moments.push({ questId: m.questId, label, attemptId: rec.attemptId, at: rec.at, weight: m.weight });
  }
  for (const f of world.campaign.failures.filter((x) => x.recoveredBy && x.questId !== "counter_offer")) {
    const rec = records.find((r) => r.attemptId === f.recoveredBy);
    moments.push({ questId: `recovery_${f.questId}`, label: `Recovered after ${f.summary.replace(/\.$/, "").toLowerCase()}`, attemptId: f.recoveredBy, at: rec?.at ?? "", weight: 7 });
  }
  return moments.sort((a, b) => a.at.localeCompare(b.at));
}

export type Stage = "advocate" | "trusted" | "working" | "distant" | "strained";
export function stageOf(n: NPCInstanceState): Stage {
  const r = n.relationship;
  if (r.trust <= -5) return "strained";
  if (r.trust >= 25 && r.respect >= 15) return r.warmth >= 15 ? "advocate" : "trusted";
  if (r.trust >= 8 || r.respect >= 10) return "working";
  return "distant";
}

/** How each recurring character ends up seeing you, in their own register. */
export const CHARACTER_OUTCOMES: Record<string, Record<Stage, string>> = {
  emma_kapoor: {
    advocate: "Would put her name behind you again, and has.",
    trusted: "Sees you as someone worth recommending.",
    working: "Remembers you as a solid hire. Not yet someone she'd stake a recommendation on.",
    distant: "Remembers the offer call more than anything since.",
    strained: "Still remembers how the negotiation went.",
  },
  rohan_mehta: {
    advocate: "Trusts your judgment under pressure and says so upstairs.",
    trusted: "Trusts your judgment under pressure.",
    working: "Checks your work, fairly. Your word is starting to carry.",
    distant: "Still deciding whether your estimates mean anything.",
    strained: "Plans around you rather than with you, for now.",
  },
  maya_sen: {
    advocate: "Backs you in the room, and tells people why.",
    trusted: "Sees you as reliable. Offers help before you ask.",
    working: "Works with you well. Keeps her evenings to herself.",
    distant: "Polite, helpful when asked, never more.",
    strained: "Stopped volunteering help. Answers the question, then goes back to her screen.",
  },
  nora_shah: {
    advocate: "Brings you into customer calls because you ask the right questions.",
    trusted: "Trusts you to explain a tradeoff to a customer without spin.",
    working: "Treats you as a useful engineer to have on a call.",
    distant: "Still thinks of you as 'the platform team'.",
    strained: "Checks everything you tell a customer before it goes out.",
  },
  vikram_rao: {
    advocate: "Asks for you by name on the next Meridian project.",
    trusted: "Believes what you tell him about his month-end.",
    working: "Will give Nova Labs another quarter.",
    distant: "Deals with Nora, not you.",
    strained: "Has started asking Nora about other vendors.",
  },
  arjun_iyer: {
    advocate: "Comes to you first when he's stuck, and tells the next new hire to.",
    trusted: "Comes to you first when he's stuck.",
    working: "Asks you for help, eventually.",
    distant: "Still says 'it's fine' when it isn't.",
    strained: "Avoids asking you anything.",
  },
  priya_nair: {
    advocate: "Saves you the last cardamom bun, and tells you the building gossip first.",
    trusted: "Knows how your job is actually going.",
    working: "Waves from the bakery. Asks about Nova Labs.",
    distant: "A friendly face in the lift.",
    strained: "A polite nod in the lift.",
  },
};

export const MAJOR_NPCS = ["emma_kapoor", "rohan_mehta", "maya_sen", "nora_shah", "vikram_rao", "arjun_iyer", "priya_nair"];

/** Short path labels for the professional outcome, for "Candidate → Engineer → …". */
export function shortProfessional(professional: string): string {
  if (/lead trial/i.test(professional)) return "Emerging Lead";
  if (/path to lead/i.test(professional)) return "Lead in Waiting";
  if (/second chance/i.test(professional)) return "Trusted Contributor";
  if (/narrower remit/i.test(professional)) return "Rebuilding Trust";
  if (/specialist/i.test(professional)) return "Specialist";
  if (/shared oversight/i.test(professional)) return "Contributor, Supervised";
  if (/lead role is still open/i.test(professional)) return "Trusted Contributor";
  return "Growing Laterally";
}

/** One remaining-challenge line per facet family. The facet itself comes from measured play. */
export const WEAKNESS_ADVICE: Record<string, string> = {
  questioning: "Ask one more question before you propose. Most of your hardest rooms turned on something you hadn't asked yet.",
  acknowledgement: "Name the other person's concern before answering it. People argue less with someone who has said their worry out loud.",
  reading_signals: "Notice the hesitation. When someone goes quiet or says 'it's fine', that is the conversation.",
  building_on: "Use what you just heard. Your best turns reused the other person's words.",
  anchoring: "Say your number first, and give it a reason.",
  discovery: "Find out what the other side can move on before you ask them to move.",
  protecting_leverage: "Keep your floor to yourself until it helps you.",
  proposing_alternatives: "When the answer is no, bring the smaller yes.",
  handling_resistance: "A refusal is information. Ask what would change it.",
  evidence: "Lead with one specific result. Adjectives don't survive a follow-up question.",
  framing: "Frame the ask in what they care about, not what you need.",
  addressing_objections: "Answer the objection they actually raised, not the one you prepared for.",
  credibility: "Promise less than you can deliver. Your word is the asset.",
  assertiveness: "State the ask plainly. You tend to circle it.",
  composure: "Slow down when the room speeds up.",
  decisiveness: "Pick a position and say it. You can revise it later.",
  ownership: "Own the part that was yours, early and in one sentence.",
  clarity: "Say the impact first, in plain words.",
  concision: "Stop one sentence earlier.",
  structure: "Tell them what you're going to say: the problem, the plan, the ask.",
  relevance: "Stay on the thing they asked about.",
  tone: "Match the room before you try to move it.",
  de_escalation: "Lower the temperature before you make your point.",
  empathy: "Show you understand their position before defending yours.",
  respectful_disagreement: "Disagree with the plan, not the person, and say what you'd do instead.",
  recovery: "When a line lands badly, repair it in the next one.",
  direction: "End every hard conversation with who does what, by when.",
  accountability: "Say what you will own, not what went wrong.",
  delegation: "Hand over the problem and the support, not the answer.",
  motivation: "Tell people why it matters, not just what to do.",
  narrative: "One concrete story beats three claims.",
  specificity: "Use the number, the name, the day.",
  relevance_to_point: "Make sure the story lands the point you need.",
};
