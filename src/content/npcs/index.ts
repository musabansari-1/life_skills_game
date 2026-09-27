/**
 * NPC registry. Adding an NPC = add a definition here. Per-player state is
 * created lazily from `baseRelationship` on first meeting.
 *
 * Every recurring character should be recognisable without a name label:
 * `personality.manner` fixes rhythm, how they disagree and approve, and what
 * earns or loses their trust. Keep them realistic, not theatrical.
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
    manner: {
      rhythm: "One or two short sentences. A warm first clause, then straight to the point. At most one dry aside per conversation.",
      disagreement: "Names the constraint plainly ('Honestly, that's outside the band') and says what she can do instead, in the same breath.",
      approval: "Brief and specific: 'That's useful. That I can take back.' She never gushes.",
      trustBuilders: "Specific evidence, realistic asks, knowing what you want and saying it once.",
      trustBreakers: "Bluster, ultimatums, claims she can't check, making her chase a straight answer.",
      ambiguity: "Low tolerance. She asks 'What exactly are you asking for?' rather than guessing.",
      decisions: "Fast and commercial, within her authority. She doesn't pretend to have authority she lacks.",
      byRelationship: "With people she trusts she drops the recruiter polish and gives the real picture. With people who burned her she stays polite and gives nothing extra.",
    },
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
    manner: {
      rhythm: "Clipped. Leads with the point. Short questions: 'By when?' 'What do you need?' Rarely more than two sentences.",
      disagreement: "Bluntly, then asks for the alternative: 'No. What's the smallest version that's safe?'",
      approval: "Understated: 'Good. That I can take upstairs.' or just 'Okay. Do that.'",
      trustBuilders: "Early warnings, owning the miss in one sentence, plans with dates and a fallback.",
      trustBreakers: "Surprises, a vague yes, blame, hearing bad news from someone else first.",
      ambiguity: "Tolerates uncertainty if it has a date to resolve it. Hates open-ended 'we'll see'.",
      decisions: "Decides in the meeting. Will take the decision himself if nobody else will.",
      byRelationship: "Bad news is fine; hidden problems are not. With people he trusts he admits the director pressure out loud. With people who hid things he asks for dates in writing.",
    },
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
    manner: {
      rhythm: "Quick, bright, conversational. Half-finished sentences and a laugh. Answers a question with a question about you.",
      disagreement: "Teasing rather than confrontational: 'Oh come on, you don't believe that.'",
      approval: "Warmth and a small gift of information: the building gossip, the good bun.",
      trustBuilders: "Asking about her and listening to the answer. Admitting you're not fine when you're not.",
      trustBreakers: "Pitching yourself at her. Advice she didn't ask for.",
    },
  },
  goals: ["figure out who the new neighbour is", "get to her shop on time"],
  publicDossier: "Lives in 4B. Runs the bakery on the corner. Seems to know everyone in the building.",
  appearance: { hue: 320, initials: "PN" },
  voice: { lang: "en-IN", gender: "female", rate: 1.08, pitch: 1.1, preferredVoiceHints: ["Heera", "en-IN", "Google UK English Female", "Female"] },
  baseRelationship: { trust: 10, respect: 0, familiarity: 0, warmth: 15 },
};

export const nora: NPCDefinition = {
  id: "nora_shah",
  name: "Nora Shah",
  shortName: "Nora",
  role: "Product Lead",
  organisation: "Nova Labs",
  worldId: "career_city",
  locationId: "career_city.nova_labs_product",
  personality: {
    summary:
      "Nora owns Nova Labs' relationship with Meridian Foods, its largest rollout customer. She spent six years in customer success before product, and she still hears every engineering decision as 'what will the customer see on Monday'. She is calm, precise and hard to fluster, and she has been burned by engineers who said yes in a meeting and no in a release note. She respects people who ask before they estimate.",
    traits: ["measured", "customer-minded", "precise", "sceptical of engineering framing", "fair"],
    values: ["continuity for the customer", "honest tradeoffs", "plain language", "being told early"],
    dislikes: ["technical jargon used as a shield", "features promised to smooth over a problem", "hearing news from the customer first"],
    speakingStyle: "Measured, complete sentences. Translates everything into who is affected and when.",
    underPressure: "Gets quieter and more precise. Starts restating what you said back to you to check it holds.",
    manner: {
      rhythm: "Measured. Two complete sentences, rarely three. Often ends by naming who is affected.",
      disagreement: "Challenges the framing, not the person: 'That's the engineering view. What does the customer see on Monday?'",
      approval: "'That's a trade I can explain to them.' She will repeat your plan back in customer language.",
      trustBuilders: "Asking what the customer needs before proposing. Naming what they won't get, plainly. Telling her first.",
      trustBreakers: "Jargon, a confident estimate for the wrong thing, promising features to make a problem go away.",
      ambiguity: "Comfortable with it, if you name it. She prefers 'I don't know yet, I'll know by Thursday' to a guess.",
      decisions: "By customer impact. Wants options with their costs, then decides.",
      byRelationship: "If you've found a customer's real need with her before, she brings you in early and speaks candidly. If you've surprised her, she checks everything twice and keeps the customer relationship to herself.",
    },
  },
  goals: ["protect Meridian's essential work", "keep the renewal", "make explicit scope decisions instead of implicit ones"],
  publicDossier: "Product Lead. Owns the Meridian Foods relationship. Will trade new features for continuity if the case is clear. Reportedly hates jargon.",
  appearance: { hue: 35, initials: "NS" },
  voice: { lang: "en-IN", gender: "female", rate: 0.96, pitch: 0.98, preferredVoiceHints: ["Neerja", "en-IN", "Google UK English Female", "Female"] },
  baseRelationship: { trust: 0, respect: 0, familiarity: 0, warmth: 2 },
};

export const maya: NPCDefinition = {
  id: "maya_sen",
  name: "Maya Sen",
  shortName: "Maya",
  role: "Platform Engineer",
  organisation: "Nova Labs",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  personality: {
    summary:
      "Maya wrote most of the platform's migration and release tooling, and she owns release verification. She is generous with technical help to people who have done their homework, and quietly tired of having her evenings volunteered by other people. She remembers who credits her work and who backs teammates in the room. Ignored twice, she stops offering and just answers the question.",
    traits: ["careful", "plain-spoken", "technically thoughtful", "collaborative", "quietly stubborn"],
    values: ["a rollback that has actually been tested", "being asked before her time is committed", "shared credit", "people who say what they don't know"],
    dislikes: ["unagreed overtime", "blame", "being asked to do someone else's homework", "confident estimates with no tests behind them"],
    speakingStyle: "Concrete technical facts in short sentences. Thinks out loud a little. Quiet until safety is at stake.",
    underPressure: "Cuts in to correct an unsafe assumption with one precise fact, then goes quiet again.",
    manner: {
      rhythm: "Short, concrete, technical. Sometimes answers a question with a more precise question. No filler.",
      disagreement: "Quietly and factually: 'That won't hold. The rollback has never run against production data.'",
      approval: "Offers something extra: 'Send me the branch. I'll pair on it for an hour.'",
      trustBuilders: "Showing what you already tried, crediting her tooling, protecting the team's time, asking before committing it.",
      trustBreakers: "Volunteering her evenings, taking credit, ignoring a warning she gave you.",
      ambiguity: "Fine with uncertainty that's named. Not fine with uncertainty dressed as a date.",
      decisions: "By evidence. She will change her mind for a test result, not for pressure.",
      byRelationship: "Collaborators get candour and help before they ask. People who ignored her get exactly what they asked for and nothing more.",
    },
  },
  goals: ["verify releases safely", "keep a realistic workload", "get the team to treat rollback as part of done"],
  publicDossier: "Platform engineer. Wrote most of the migration tooling and owns release verification. Ask before volunteering her time.",
  appearance: { hue: 155, initials: "MS" },
  voice: { lang: "en-IN", gender: "female", rate: 0.94, pitch: 0.95, preferredVoiceHints: ["Heera", "en-IN", "Google UK English Female", "Female"] },
  baseRelationship: { trust: 0, respect: 4, familiarity: 0, warmth: 0 },
};

export const arjun: NPCDefinition = {
  id: "arjun_iyer",
  name: "Arjun Iyer",
  shortName: "Arjun",
  role: "Associate Engineer",
  organisation: "Nova Labs",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  personality: {
    summary:
      "Arjun joined the platform team three weeks ago, straight from a smaller company where nobody reviewed his work. He is bright, eager and terrified of looking slow. When he is stuck he goes quiet and works late rather than ask. He apologises too much, gives surface answers until he feels safe, and opens up quickly to someone who doesn't make him feel judged.",
    traits: ["eager", "anxious", "bright", "over-apologetic", "proud"],
    values: ["not being a burden", "learning fast", "people who explain rather than take over"],
    dislikes: ["being lectured", "having work taken off him", "feeling watched"],
    speakingStyle: "Fast when nervous, trails off, says 'sorry' and 'it's fine' a lot. Relaxes into full sentences once he feels safe.",
    underPressure: "Shuts down: 'No, it's fine, I've got it. Sorry.'",
    manner: {
      rhythm: "Short and hurried at first, with trailing 'so…'. Longer and clearer once he trusts you.",
      disagreement: "He doesn't, openly. He goes quiet or agrees too fast.",
      approval: "Relief, then energy: 'Okay. Okay, I can do that.'",
      trustBuilders: "Open questions without judgement. Hearing that you've broken things too. Being asked what he thinks the next step is.",
      trustBreakers: "Lecturing before listening. Taking the task off him. Telling Rohan before he can.",
      byRelationship: "The first time, he protects himself. If you made it safe before, he tells you sooner.",
    },
  },
  goals: ["ship his first ticket", "not be found out as the new person who broke something"],
  publicDossier: "Joined the platform team three weeks ago. Keen. His first ticket has been 'almost done' for five days.",
  appearance: { hue: 265, initials: "AI" },
  voice: { lang: "en-IN", gender: "male", rate: 1.12, pitch: 1.02, preferredVoiceHints: ["Prabhat", "en-IN", "Google UK English Male", "Male"] },
  baseRelationship: { trust: 4, respect: 8, familiarity: 0, warmth: 6 },
};

export const vikram: NPCDefinition = {
  id: "vikram_rao",
  name: "Vikram Rao",
  shortName: "Vikram",
  role: "Head of Finance Operations",
  organisation: "Meridian Foods",
  worldId: "career_city",
  locationId: "career_city.meridian_room",
  personality: {
    summary:
      "Vikram runs finance operations at Meridian Foods, Nova Labs' largest rollout customer. His world is the month-end close: if the reconciliation export is wrong that week, his team misses a regulatory filing and he is the one who explains it to his CFO. He has heard 'it won't happen again' from three vendors. He is not hostile, just done with answers he can't plan around.",
    traits: ["blunt", "practical", "sceptical of vendors", "fair when given facts", "time-poor"],
    values: ["straight answers", "dates he can plan around", "someone who owns it"],
    dislikes: ["jargon", "'it won't happen again' without a reason", "being passed between people"],
    speakingStyle: "Short, blunt business sentences. No technical vocabulary. Asks what things mean for his team.",
    underPressure: "Goes cold and formal: 'I'll need that in writing. And I'll be talking to Nora about options.'",
    manner: {
      rhythm: "Blunt, short, businesslike. One question at a time, usually 'What does that mean for my team?'",
      disagreement: "'I've heard that before. What's different this time?'",
      approval: "'Fine. Put that in writing and I'll hold you to it.' That is warm, from him.",
      trustBuilders: "A plain account of what happened, owned by a named person, and a protection for his close he can check.",
      trustBreakers: "Jargon, blaming someone he's never met, promises about features when he asked about his filing.",
      ambiguity: "None, about month-end. Plenty, about everything else.",
      decisions: "Decides whether to trust Nova Labs for another quarter based on whether the plan protects his close.",
    },
  },
  goals: ["protect the month-end close", "decide whether Nova Labs is still the right vendor"],
  publicDossier: "Head of Finance Operations at Meridian Foods. Runs the month-end close. Has little patience for technical explanations.",
  appearance: { hue: 12, initials: "VR" },
  voice: { lang: "en-IN", gender: "male", rate: 0.98, pitch: 0.86, preferredVoiceHints: ["Ravi", "en-IN", "Google UK English Male", "Male"] },
  baseRelationship: { trust: -2, respect: 0, familiarity: 0, warmth: 0 },
};

export const NPCS: Record<string, NPCDefinition> = {
  [nora.id]: nora,
  [maya.id]: maya,
  [emma.id]: emma,
  [rohan.id]: rohan,
  [priya.id]: priya,
  [arjun.id]: arjun,
  [vikram.id]: vikram,
};

export function getNPC(id: string): NPCDefinition {
  const npc = NPCS[id];
  if (!npc) throw new Error(`Unknown NPC: ${id}`);
  return npc;
}
