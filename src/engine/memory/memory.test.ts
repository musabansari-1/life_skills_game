import { describe, expect, it } from "vitest";
import { NPCMemorySchema, type MemoryExtraction } from "../types/npc";
import { makeTestEnv } from "../util";
import { MEMORY_CAPS, mergeMemory, renderMemoryBlock, resolveCommitment, selectMemoryForPrompt } from "./index";

const env = makeTestEnv();
const ctx = { questId: "counter_offer", attemptId: "a1", env };

const extraction: MemoryExtraction = {
  facts: [{ key: "player.current_employer", statement: "Works at Finlytics.", confidence: 0.8 }],
  beliefs: [{ key: "prepared", statement: "Came prepared with numbers.", valence: 0.7, strength: 0.6, evidence: "cited a benchmark" }],
  events: [{ summary: "We negotiated their offer up to 9.7 lakh.", importance: 0.9, emotionalTone: "positive" }],
  commitments: [{ by: "npc", description: "Send the revised letter today.", dueBy: null }],
  interactionSummary: "Went well; they were sharp.",
};

describe("mergeMemory", () => {
  it("adds new items and sets the interaction summary", () => {
    const m = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0].key).toBe("player.current_employer");
    expect(m.beliefs[0].key).toBe("prepared");
    expect(m.events[0].questId).toBe("counter_offer");
    expect(m.commitments[0].status).toBe("open");
    expect(m.lastInteractionSummary).toBe("Went well; they were sharp.");
  });

  it("de-duplicates facts by key and by similar statement", () => {
    const m1 = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    const m2 = mergeMemory(
      m1,
      {
        ...extraction,
        facts: [
          { key: "Player.Current_Employer", statement: "Now works at Finlytics as a senior engineer.", confidence: 0.9 },
          { key: "employer_again", statement: "Now works at Finlytics as a senior engineer.", confidence: 0.5 },
        ],
        beliefs: [],
        events: [],
        commitments: [],
      },
      { ...ctx, questId: "first_day_nova_labs" },
    );
    expect(m2.facts).toHaveLength(1);
    expect(m2.facts[0].statement).toContain("senior engineer");
    expect(m2.facts[0].sourceQuestId).toBe("first_day_nova_labs");
  });

  it("blends beliefs instead of duplicating them", () => {
    const m1 = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    const m2 = mergeMemory(m1, { ...extraction, beliefs: [{ key: "prepared", statement: "Winged it this time.", valence: -0.5, strength: 0.5, evidence: "no numbers" }], facts: [], events: [], commitments: [] }, ctx);
    expect(m2.beliefs).toHaveLength(1);
    expect(m2.beliefs[0].valence).toBeLessThan(0.7);
    expect(m2.beliefs[0].valence).toBeGreaterThan(-0.5);
  });

  it("does not duplicate events or open commitments from the same conversation", () => {
    const m1 = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    const m2 = mergeMemory(m1, extraction, ctx);
    expect(m2.events).toHaveLength(1);
    expect(m2.commitments).toHaveLength(1);
  });

  it("enforces caps keeping the most important events", () => {
    let m = NPCMemorySchema.parse({});
    for (let i = 0; i < MEMORY_CAPS.events + 10; i++) {
      m = mergeMemory(m, { ...extraction, facts: [], beliefs: [], commitments: [], events: [{ summary: `Event number ${i} happened uniquely ${i * 7}`, importance: i % 2 ? 0.9 : 0.1, emotionalTone: "neutral" }] }, { ...ctx, questId: `q${i}` });
    }
    expect(m.events.length).toBe(MEMORY_CAPS.events);
    expect(m.events.filter((e) => e.importance === 0.9).length).toBeGreaterThan(m.events.filter((e) => e.importance === 0.1).length);
  });

  it("resolves commitments and excludes them from prompt selection", () => {
    const m1 = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    const m2 = resolveCommitment(m1, m1.commitments[0].id, "fulfilled");
    expect(m2.commitments[0].status).toBe("fulfilled");
    expect(selectMemoryForPrompt(m2).commitments).toHaveLength(0);
  });

  it("renders a bounded prose block", () => {
    const m = mergeMemory(NPCMemorySchema.parse({}), extraction, ctx);
    const block = renderMemoryBlock(m, "Asha");
    expect(block).toContain("Last time you spoke");
    expect(block).toContain("Finlytics");
    expect(block).toContain("You promised");
    expect(renderMemoryBlock(NPCMemorySchema.parse({}), "Asha")).toContain("no prior history");
  });
});
