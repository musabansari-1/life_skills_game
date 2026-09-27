/**
 * THE CODEBASE NOBODY EXPLAINS — Act 2 opener. Relationship + discovery.
 *
 * You need Maya's help with the migration tooling she wrote. The test is how
 * you ask: a specific question, what you already tried, respect for her time.
 * The right question also surfaces a fact that matters later: the rollback
 * script has never run against production-sized data. That fact is evidence
 * in "Push Back on a Deadline" and follows Maya into the Project Crisis.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneAllowed } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

const ROLLBACK_LINE = "Honest answer? The rollback script has never run against production-sized data. It works on staging. That's all I'd promise anyone.";
const HELP_LINE = "Okay. That's a question I can answer in ten minutes. Pull up the runner, I'll show you where the batches are split.";

export const meetMaya = defineQuest({
  id: "meet_maya",
  title: "The Codebase Nobody Explains",
  tagline: "You need Maya's help. How you ask decides whether you get it again.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "maya_sen",
  difficulty: 1,
  skills: ["listening", "communication", "confidence"],
  order: 45,
  pacing: { category: "relationship", intensity: 2, emotionalPressure: 2, importance: 3, urgency: "normal" },
  prerequisites: [
    { type: "world_flag", flag: "nova_labs.joined" },
    { type: "custom", label: "Start your first day at Nova Labs.", check: ({ world }) => milestoneAllowed(world, "meet_maya") },
  ],
  transition: () => ({ when: "Your first week", message: "The migration tickets are yours now. The tooling is Maya's." }),
  briefing: {
    situation:
      "Rohan has handed you the database migration tickets. The scripts call a rollback path nobody has explained, and the runner's batching logic makes no sense yet. Maya Sen wrote most of it. She has headphones on and a release to verify.",
    objective: "Get the help you actually need from Maya, and leave her glad you asked.",
    intel: [
      "Maya owns release verification. Her time is the team's scarcest resource.",
      "You've read the runner's README and traced one batch by hand. You're stuck on how rollback is triggered.",
      "People who ask well get help again. People who don't get a link.",
    ],
    hint: "Say what you tried, ask one specific thing, and notice what it costs her.",
  },
  carryOver: ({ world }) => [
    ...(world.vars["nova_labs.knows_release_late"] ? ["Emma told you the release is three weeks late and two people left. Maya is carrying some of that."] : []),
    ...(world.flags.includes("interview.overpromised") ? ["You told Rohan you'd be shipping in week one. It's week one."] : []),
  ],
  semanticFeatures: [
    { id: "specific_ask", description: "Asks for help with a specific, bounded question or names exactly where they are stuck, rather than asking to have everything explained." },
    { id: "did_homework", description: "Shows what they already tried, read or understand before asking for help." },
    { id: "respects_time", description: "Acknowledges Maya's time or workload, or offers to fit around it: a timebox, a later slot, or async." },
    { id: "rollback_question", description: "Asks how the rollback path works, whether it has been tested, or what could go wrong with the migration." },
    { id: "gives_back", description: "Offers something in return or credits Maya's work: offers to document what they learn, take something off her plate, or acknowledges the tooling she built." },
    { id: "dumps_work", description: "Asks Maya to do their work for them, to own their task, or volunteers her time for something without asking. Revoke if explicitly withdrawn." },
  ],
  objectives: [
    { id: "ask_well", label: "Ask a specific question", kind: "primary", description: "Name exactly where you're stuck.", check: (s) => has(s, "specific_ask") },
    { id: "respect", label: "Respect her time", kind: "primary", description: "Show you know what her time costs.", check: (s) => has(s, "respects_time") && !has(s, "dumps_work") },
    { id: "rollback", label: "Find out what the rollback can be trusted to do", kind: "hidden", description: "Ask about the rollback path.", check: (s) => s.revealed.includes("rollback_untested") },
    { id: "give_back", label: "Leave something behind", kind: "optional", description: "Offer something back or credit her work.", check: (s) => has(s, "gives_back") },
  ],
  scene: {
    createHidden: ({ world }) => ({ rushedHistory: world.flags.includes("interview.overpromised") }),
    createCustom: () => ({}),
    initialPatience: () => 62,
    opening: { scripted: () => "Hm? Sorry, I was in the middle of a verification run. What's up?" },
    npcSituation: ({ playerName }) => `${playerName} joined the platform team this week and has the migration tickets. You wrote most of the migration tooling and you're mid-way through verifying a release. You'll help people who've done their homework. ${BEAT_NOTE}`,
    hiddenBriefing: () => "You know the rollback script has never been run against production-sized data; only staging. You don't volunteer that unless asked about rollback, testing or risk. If they ask you to do their work, give them a pointer and go back to your screen. If they ask well, offer a short pairing session.",
    revealableKeys: { rollback_untested: "Only when asked about rollback, testing or migration risk.", pairing_offer: "When they ask specifically and respect your time." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const direction = [
        fresh(s, "dumps_work") ? beat("Decline to take on their task. Give one pointer (the runner README, section on batches) and turn back to your screen.")
          : fresh(s, "specific_ask") && !s.revealed.includes("pairing_offer") ? beat("They asked something answerable. Answer it concretely in one sentence, and offer ten minutes at their screen.")
          : !has(s, "specific_ask") ? beat("You're not sure what they need. Ask what exactly they're stuck on.")
          : beat("Help briefly and concretely. If they haven't asked about rollback, don't bring it up."),
      ];
      return { custom, dropSignals: ["accepted_terms"], direction };
    },
    canonicalSpeech: ({ scene }) =>
      disclose(scene, "rollback_untested", fresh(scene, "rollback_question") && !has(scene, "dumps_work"), ROLLBACK_LINE)
      ?? disclose(scene, "pairing_offer", fresh(scene, "specific_ask") && hasAny(scene, "did_homework", "respects_time") && !has(scene, "dumps_work"), HELP_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { rollback_untested: ROLLBACK_LINE, pairing_offer: HELP_LINE }) }),
    director: ({ scene }) => [
      has(scene, "dumps_work") ? "They tried to hand you their work. Stay polite and brief; you have a release to verify." : "Friendly but busy. Short sentences. Technical and concrete.",
      scene.turnCount >= 4 ? "Wrap up naturally: you need to get back to the verification run." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Maya", value: scene.revealed.includes("pairing_offer") ? "Offered to pair" : has(scene, "dumps_work") ? "Back to her screen" : "Listening, headphones half off" }],
    minTurns: 2,
    maxTurns: 7,
  },
  rubric: [
    { id: "specific", skill: "communication", facet: "clarity", label: "A specific ask", description: "Did the player name exactly where they were stuck?", anchors: { exemplary: "'I traced one batch; I can't see what triggers rollback. Can you show me where?'", weak: "'Can you explain the migration stuff?'" }, weight: 1.2 },
    { id: "questions", skill: "listening", facet: "questioning", label: "The useful question", description: "Did the player ask something that surfaced real risk or information?", anchors: { exemplary: "Asked whether the rollback had been tested on real data.", weak: "Asked nothing beyond their immediate task." }, weight: 1 },
    { id: "respect", skill: "listening", facet: "reading_signals", label: "Reading the room", description: "Did the player notice she was busy and adapt?", anchors: { exemplary: "Offered a timebox or a later slot.", weak: "Ploughed on while she was mid-verification." }, weight: 0.8 },
    { id: "ask_confidently", skill: "confidence", facet: "assertiveness", label: "Asking without apologising", description: "Did the player ask plainly, without an apology spiral?", anchors: { exemplary: "One clear request.", weak: "Three apologies before the question." }, weight: 0.6 },
  ],
  evaluatorNotes: "SCENE_KIT. A short first conversation between colleagues. Reward a specific, homework-backed ask and respect for her time. Politeness alone is not listening. Asking about rollback risk is a strong move.",
  outcomes: [
    {
      id: "ally", label: "Maya offered to pair", grade: "success",
      when: ({ scene }) => has(scene, "specific_ask") && has(scene, "respects_time") && hasAny(scene, "did_homework", "gives_back") && !has(scene, "dumps_work"),
      narrative: ({ scene }) => scene.revealed.includes("rollback_untested")
        ? "You asked a real question and got a real answer: the rollback has never run on production-sized data. Maya gave you twenty minutes and a standing offer."
        : "You asked well. Maya showed you the runner and told you to ping her before you touch rollback. That offer won't be made to everyone.",
      consequences: ({ scene }) => {
        const out: Consequence[] = [
          { type: "relationship.delta", npcId: "maya_sen", delta: { trust: 8, respect: 6, warmth: 8, familiarity: 15 } },
          { type: "world.flag.add", flag: "maya.collaborator" },
          { type: "world.unlock.location", locationId: "career_city.nova_labs_product" },
          { type: "world.decision.add", description: "Asked Maya for help the right way; she offered to pair." },
        ];
        if (scene.revealed.includes("rollback_untested")) out.push({ type: "world.flag.add", flag: "knows.rollback_untested" });
        return out;
      },
      aftermath: ({ scene }) => [
        "Maya will remember that you asked well. That tends to come back.",
        ...(scene.revealed.includes("rollback_untested") ? ["You know something Rohan may not: the rollback has never run on production-sized data."] : []),
      ],
      rewardMultiplier: 1.15, followUpQuestIds: ["push_back_on_deadline"],
    },
    {
      id: "helped", label: "A quick answer", grade: "partial", setback: false,
      when: ({ scene }) => hasAny(scene, "specific_ask", "did_homework") && !has(scene, "dumps_work"),
      narrative: ({ scene }) => scene.revealed.includes("rollback_untested")
        ? "Maya answered your question and, when you asked, told you the rollback has never run on real data. She was helpful and gone again in five minutes."
        : "Maya answered the question you asked and went back to her run. Useful. Not memorable.",
      consequences: ({ scene }) => [
        { type: "relationship.delta", npcId: "maya_sen", delta: { trust: 3, respect: 2, familiarity: 10 } },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_product" },
        ...(scene.revealed.includes("rollback_untested") ? [{ type: "world.flag.add" as const, flag: "knows.rollback_untested" }] : []),
      ],
      aftermath: () => ["Maya helped. She didn't offer to do it again."],
      rewardMultiplier: 0.9, followUpQuestIds: ["push_back_on_deadline"],
    },
    {
      id: "brushed_off", label: "A link and a closed door", grade: "partial", setback: false,
      when: () => true,
      narrative: () => "Maya sent you a link to the README and put her headphones back on. You'll work it out alone, and she'll remember who asked her to do their homework.",
      consequences: () => [
        { type: "relationship.delta", npcId: "maya_sen", delta: { trust: -3, warmth: -6, familiarity: 8 } },
        { type: "world.flag.add", flag: "maya.distant" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_product" },
        { type: "world.decision.add", description: "Asked Maya to do the work instead of asking for help." },
      ],
      aftermath: () => ["Maya will answer your questions. She won't volunteer anything. That matters when the rollback does."],
      rewardMultiplier: 0.6, followUpQuestIds: ["push_back_on_deadline"],
    },
  ],
  rewards: { baseXp: 70, skills: { listening: 0.45, communication: 0.35, confidence: 0.2 } },
});
