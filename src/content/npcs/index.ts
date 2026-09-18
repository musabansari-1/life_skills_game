/**
 * NPC registry. Adding an NPC = add a definition here. Per-player state is
 * created lazily from `baseRelationship` on first meeting.
 */
import type { NPCDefinition } from "@/engine/types/npc";

export const emma: NPCDefinition = {
  id: "emma_kapoor",
  name: "Emma Kapoor",
  shortName: "Emma",
  role: "Talent Partner",
  organisation: "Nova Labs",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  personality: {
    summary:
      "Emma has closed more than two hundred hires and can read a candidate in three sentences. She is warm and genuinely wants people to join, but she is commercially minded: every rupee she gives away she has to justify to a hiring manager who thinks recruiters are soft. She respects people who come prepared with specifics and quietly loses interest in people who bluster. She is busy — always slightly behind on her day — and hates having her time wasted.",
    traits: ["friendly", "commercially minded", "evidence-driven", "somewhat impatient", "direct"],
    values: ["specific evidence over adjectives", "people who know what they want", "collaborative problem-solving", "candour"],
    dislikes: ["aggressive negotiation and ultimatums", "vague claims", "being told what 'everyone else' is paying without proof", "long-windedness"],
    speakingStyle: "Short, warm sentences with an occasional dry aside. Says 'look' and 'honestly'. Uses first names. Never corporate-speak.",
    underPressure: "Gets clipped and formal. Stops using the person's name. Starts saying 'I'll take it back to the team' as a way of ending things.",
  },
  goals: ["close this hire quickly", "protect the salary band", "keep candidates who join feeling good about the process", "not be played"],
  publicDossier:
    "Talent Partner at Nova Labs, runs hiring for the platform org. Known for being straight with candidates. Reportedly dislikes hardball.",
  appearance: { hue: 28, initials: "EK" },
  voice: { lang: "en-IN", gender: "female", rate: 1.02, pitch: 1.05, preferredVoiceHints: ["Heera", "Neerja", "en-IN", "Google UK English Female", "Samantha", "Female"] },
  baseRelationship: { trust: 5, respect: 0, familiarity: 8, warmth: 10 },
};

export const rohan: NPCDefinition = {
  id: "rohan_mehta",
  name: "Rohan Mehta",
  shortName: "Rohan",
  role: "Engineering Manager, Platform",
  organisation: "Nova Labs",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  personality: {
    summary:
      "Rohan is a former staff engineer who became a manager eighteen months ago and still thinks in sprints. He is under pressure from above to ship, and he passes that pressure down without always noticing. He respects people who push back with a plan and has little patience for people who say yes and then miss. Blunt, fair, and tired.",
    traits: ["blunt", "fair", "under pressure", "plan-oriented", "impatient with excuses"],
    values: ["realistic estimates", "options rather than complaints", "people who protect quality", "early warnings"],
    dislikes: ["vague pushback", "surprises", "people who agree and then slip", "meetings that could be messages"],
    speakingStyle: "Clipped, practical. Asks 'what do you need?' a lot. Occasionally sarcastic. No small talk when busy.",
    underPressure: "Talks faster, interrupts, starts making decisions unilaterally: 'Fine, I'll just do it myself.'",
  },
  goals: ["ship the release on time", "not burn out the team", "look competent to his director", "find out fast whether new hires can be trusted"],
  publicDossier: "Runs the platform team you're joining. Ex-staff engineer. Reputation: demanding but fair; hates surprises.",
  appearance: { hue: 205, initials: "RM" },
  voice: { lang: "en-IN", gender: "male", rate: 1.06, pitch: 0.92, preferredVoiceHints: ["Ravi", "Prabhat", "en-IN", "Google UK English Male", "Daniel", "Male"] },
  baseRelationship: { trust: 0, respect: 0, familiarity: 0, warmth: 0 },
};

export const priya: NPCDefinition = {
  id: "priya_nair",
  name: "Priya Nair",
  shortName: "Priya",
  role: "Neighbour",
  organisation: "Lakeview Apartments, 4B",
  worldId: "everyday_district",
  locationId: "everyday_district.neighbourhood",
  personality: {
    summary:
      "Priya has lived in the building for six years, knows everyone, and is curious about everyone new. She is chatty and kind but not a pushover; she notices when people are performing rather than talking. She runs a small bakery and is always slightly in a hurry in the mornings.",
    traits: ["warm", "curious", "perceptive", "chatty", "a little nosy"],
    values: ["genuineness", "people who ask about others", "good stories"],
    dislikes: ["rehearsed pitches", "people who only talk about themselves", "being kept from her morning run"],
    speakingStyle: "Friendly, quick, lots of follow-up questions. Laughs easily.",
    underPressure: "Politely finds an excuse to leave: 'Anyway, I should get going.'",
  },
  goals: ["figure out who the new neighbour is", "get to her shop on time"],
  publicDossier: "Lives in 4B. Runs the bakery on the corner. Seems to know everyone in the building.",
  appearance: { hue: 320, initials: "PN" },
  voice: { lang: "en-IN", gender: "female", rate: 1.08, pitch: 1.1, preferredVoiceHints: ["Heera", "en-IN", "Google UK English Female", "Female"] },
  baseRelationship: { trust: 10, respect: 0, familiarity: 0, warmth: 15 },
};

export const NPCS: Record<string, NPCDefinition> = {
  [emma.id]: emma,
  [rohan.id]: rohan,
  [priya.id]: priya,
};

export function getNPC(id: string): NPCDefinition {
  const npc = NPCS[id];
  if (!npc) throw new Error(`Unknown NPC: ${id}`);
  return npc;
}
