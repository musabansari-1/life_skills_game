/**
 * Difficulty as behaviour, not a hidden number.
 *
 * A quest's difficulty (1-5) shapes how much resistance the NPC puts up:
 * starting patience, how fast concessions unlock, how readily information is
 * revealed, and the behavioural direction the NPC model receives. Harder
 * characters are not ruder; they are more like a strong real-world counterpart.
 *
 * Pure: content and the orchestrator read from here; nothing else defines
 * difficulty behaviour.
 */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface DifficultyProfile {
  level: DifficultyLevel;
  label: "easy" | "approachable" | "medium" | "hard" | "expert";
  /** Added to the quest's initial patience. */
  patienceOffset: number;
  /** Multiplier on how much of the remaining headroom a good turn can unlock. */
  concessionScale: number;
  /** Multiplier on the per-turn patience cost of a weak or empty line (>1 = less forgiving). */
  weakTurnCost: number;
  /** Behavioural direction for the NPC model, appended to the director notes. */
  notes: string[];
}

const PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  1: {
    level: 1,
    label: "easy",
    patienceOffset: 12,
    concessionScale: 1.25,
    weakTurnCost: 0.6,
    notes: [
      "Difficulty: easy. You are patient and give them room. If a line is vague or incomplete, ask one simple follow-up rather than pushing back.",
      "Let them recover from a weak moment; don't hold a stumble against them.",
    ],
  },
  2: {
    level: 2,
    label: "approachable",
    patienceOffset: 5,
    concessionScale: 1.1,
    weakTurnCost: 0.8,
    notes: ["Difficulty: approachable. Professional and fair. Ask for specifics when something is vague, but don't make them fight for basics."],
  },
  3: {
    level: 3,
    label: "medium",
    patienceOffset: 0,
    concessionScale: 1,
    weakTurnCost: 1,
    notes: ["Difficulty: medium. Neutral and businesslike. Challenge weak reasoning; expect specifics before you move; don't volunteer what they haven't asked for."],
  },
  4: {
    level: 4,
    label: "hard",
    patienceOffset: -8,
    concessionScale: 0.75,
    weakTurnCost: 1.25,
    notes: [
      "Difficulty: hard. You are sceptical by default. Push back quickly on claims without proof, notice inconsistencies with what they said earlier and name them, and reveal less than you know unless they ask precisely the right question.",
      "Stay courteous. Resistance, not rudeness: you are simply a strong counterpart who has done this many times.",
    ],
  },
  5: {
    level: 5,
    label: "expert",
    patienceOffset: -15,
    concessionScale: 0.55,
    weakTurnCost: 1.5,
    notes: [
      "Difficulty: expert. You are highly resistant and short on time. Object sharply and specifically, withhold information strategically, and remember every contradiction.",
      "Do not rescue them from a weak line: if they ramble or hedge, redirect to what you need, or move on. You may cut a wandering answer short with a pointed question.",
      "Still professional: firm and precise, never contemptuous.",
    ],
  },
};

export function difficultyProfile(level: number | undefined): DifficultyProfile {
  const l = Math.max(1, Math.min(5, Math.round(level ?? 3))) as DifficultyLevel;
  return PROFILES[l];
}
