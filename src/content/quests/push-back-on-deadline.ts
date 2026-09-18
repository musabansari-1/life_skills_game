/**
 * PUSH BACK ON A DEADLINE — second NPC, commitment tracking.
 *
 * Rohan wants the migration by Friday. It isn't possible without cutting
 * quality. The player must push back with a plan. Whatever they commit to is
 * recorded as a world commitment that a later quest can hold them to.
 */
import { defineQuest } from "@/engine/types/quest";

interface Hidden extends Record<string, unknown> {
  realDeadline: string; // what Rohan actually needs
  directorPressure: boolean;
  knowsReleaseLate: boolean;
}
interface Scene extends Record<string, unknown> {
  agreedDate: "friday" | "monday" | "wednesday" | null;
  scopeNarrowed: boolean;
  alternativeProposed: boolean;
  capitulated: boolean;
}

export const pushBackOnDeadline = defineQuest<Hidden, Scene>({
  id: "push_back_on_deadline",
  title: "Push Back on a Deadline",
  tagline: "Rohan wants it Friday. It can't be done well by Friday.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "rohan_mehta",
  difficulty: 2,
  skills: ["conflict_resolution", "communication", "confidence", "negotiation"],
  order: 30,
  briefing: {
    situation: "Week two. Rohan drops by your desk: the database migration needs to be done by Friday for the release. You've scoped it — done properly, it's Wednesday next week. Rushing it means skipping the rollback path.",
    objective: "Protect the quality of the work without becoming the person who says no.",
    intel: ["Rohan respects plans and hates surprises.", "The release is already late.", "Nobody has told Rohan about the rollback risk yet."],
    hint: "Say what you can do by Friday, not just what you can't.",
  },
  prerequisites: [{ type: "world_unlocked_quest", questId: "push_back_on_deadline" }, { type: "world_flag", flag: "nova_labs.joined" }],
  objectives: [
    { id: "protect_quality", label: "Protect the rollback path", kind: "primary", description: "Don't agree to ship without a rollback path.", check: (s) => !(s.custom as Scene).capitulated },
    { id: "offer_alternative", label: "Propose a concrete alternative", kind: "hidden", description: "Offer a narrower Friday deliverable plus a real completion date.", check: (s) => (s.custom as Scene).alternativeProposed },
    { id: "commit_date", label: "Agree a specific date", kind: "optional", description: "End with an agreed, specific completion date.", check: (s) => (s.custom as Scene).agreedDate !== null },
  ],
  scene: {
    createHidden: ({ world }) => ({
      realDeadline: "The release demo is Tuesday; Monday would actually be fine.",
      directorPressure: true,
      knowsReleaseLate: world.vars["nova_labs.knows_release_late"] === true,
    }),
    createCustom: () => ({ agreedDate: null, scopeNarrowed: false, alternativeProposed: false, capitulated: false }),
    initialPatience: () => 55,
    opening: { generatedHint: "You're stopping by their desk, in a hurry. Tell them you need the migration done by Friday for the release. Be direct, not rude." },
    npcSituation: ({ hidden, playerName }) =>
      `You need ${playerName}'s database migration in by Friday for the release. Your director is on your back. ${hidden.knowsReleaseLate ? `${playerName} already knows the release is late.` : ""} You don't yet know that rushing it skips the rollback path.`,
    hiddenBriefing: ({ hidden }) =>
      [
        `The truth: ${hidden.realDeadline} You say Friday because you want buffer. Reveal this only if they ask what the Friday date is actually driven by, or propose a credible plan that lands Monday.`,
        `If they tell you rushing skips the rollback path, that genuinely worries you — you've been burned before. You'll accept a later date if there's a concrete plan.`,
        `If they just say "it can't be done" with no alternative, you get irritated and say you'll find someone who can.`,
        `If they cave and say Friday is fine, accept it — but you'll remember if it goes wrong.`,
      ].join("\n"),
    revealableKeys: {
      real_deadline: "you admitted the demo is Tuesday and Monday would do",
      burned_before: "you mentioned a previous migration that went wrong without a rollback",
    },
    proposalKeys: {
      agreedDate: "one of 'friday' | 'monday' | 'wednesday' if you and the player have agreed a completion date in this speech",
      capitulated: "true if the player agreed to the Friday deadline without protecting quality",
      alternativeProposed: "true if the player proposed a narrower Friday deliverable plus a later full completion",
    },
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      const flags: string[] = [];
      const d = moves.proposal.agreedDate;
      if (d === "friday" || d === "monday" || d === "wednesday") custom.agreedDate = d;
      if (moves.proposal.capitulated === true) custom.capitulated = true;
      if (moves.proposal.alternativeProposed === true || moves.noticed.includes("proposed_alternative")) {
        custom.alternativeProposed = true;
        flags.push("alternative_proposed");
      }
      return { custom, flags };
    },
    director: ({ scene }) => {
      const notes: string[] = [];
      if (!scene.custom.alternativeProposed && scene.turnCount >= 2) notes.push("They haven't offered a plan yet. Press: 'So what CAN you do by Friday?'");
      if (scene.custom.alternativeProposed && !scene.custom.agreedDate) notes.push("They've offered a plan. If it's concrete, negotiate the date and agree one; set proposal.agreedDate.");
      if (scene.custom.agreedDate) notes.push("A date is agreed. Wrap up briskly; you have other fires.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "disagree", skill: "conflict_resolution", facet: "respectful_disagreement", label: "Respectful disagreement", description: "Did the player say no to Friday clearly without hostility or apology spirals?", anchors: { exemplary: "'Friday isn't safe, and here's why' — calm and specific.", weak: "Either caved, or got defensive." }, weight: 1.2 },
    { id: "alternative", skill: "negotiation", facet: "proposing_alternatives", label: "Proposing alternatives", description: "Did the player propose what could be done by Friday plus a real completion date?", anchors: { exemplary: "Narrower Friday deliverable, full migration Monday with rollback.", weak: "Only said what couldn't be done." }, weight: 1.3 },
    { id: "clarity", skill: "communication", facet: "clarity", label: "Clarity", description: "Was the risk explained in plain terms Rohan could repeat to his director?", anchors: { exemplary: "One sentence on the rollback risk and its consequence.", weak: "Technical rambling or vague 'it's risky'." }, weight: 1 },
    { id: "questions", skill: "listening", facet: "questioning", label: "Questioning", description: "Did the player ask what Friday was actually driven by?", anchors: { exemplary: "Asked what depends on Friday and discovered Monday works.", weak: "Never asked." }, weight: 0.9 },
    { id: "assert", skill: "confidence", facet: "assertiveness", label: "Assertiveness", description: "Did the player hold their position under pressure?", anchors: { exemplary: "Held the line on rollback while staying flexible on scope.", weak: "Folded when Rohan pushed." }, weight: 0.9 },
  ],
  outcomes: [
    {
      id: "plan_agreed",
      label: "Plan agreed",
      grade: "success",
      when: ({ scene }) => !scene.custom.capitulated && scene.custom.alternativeProposed && scene.custom.agreedDate !== null && scene.custom.agreedDate !== "friday",
      narrative: ({ scene }) => `Rohan agreed to ${scene.custom.agreedDate === "monday" ? "Monday" : "Wednesday"} with a narrower Friday deliverable. He's holding you to it.`,
      consequences: ({ scene }) => [
        { type: "world.commitment.add", description: `Deliver the full migration with rollback by ${scene.custom.agreedDate === "monday" ? "Monday" : "Wednesday"}; partial deliverable Friday.`, toNpcId: "rohan_mehta", dueBy: null },
        { type: "world.reputation.delta", domain: "career_city", delta: 5 },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: 12, trust: 8, familiarity: 15, warmth: 4 } },
      ],
      rewardMultiplier: 1.2,
    },
    {
      id: "capitulated",
      label: "Agreed to Friday",
      grade: "failure",
      when: ({ scene }) => scene.custom.capitulated || scene.custom.agreedDate === "friday",
      narrative: () => "You said Friday. Rohan walked off satisfied. The rollback path is not going to exist.",
      consequences: () => [
        { type: "world.commitment.add", description: "Ship the migration by Friday (without rollback path).", toNpcId: "rohan_mehta", dueBy: null },
        { type: "world.flag.add", flag: "nova_labs.rushed_migration" },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -4, trust: 2, familiarity: 12 } },
      ],
      rewardMultiplier: 0.6,
    },
    {
      id: "stalemate",
      label: "Unresolved",
      grade: "partial",
      when: () => true,
      narrative: () => "Rohan left without a decision. He'll escalate, and you'll have the same conversation with less goodwill.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -2, familiarity: 10, warmth: -3 } },
        { type: "world.flag.add", flag: "nova_labs.deadline_unresolved" },
      ],
      rewardMultiplier: 0.8,
    },
  ],
  rewards: { baseXp: 80, skills: { conflict_resolution: 1, communication: 0.7, confidence: 0.6, negotiation: 0.5 } },
});
