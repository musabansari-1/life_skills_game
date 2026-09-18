import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cleanSpeech, extractStreamingSpeech, parseNpcTurn } from "./format";
import { extractJsonBlock, parseJsonWithSchema, repairJson } from "./json";

describe("parseNpcTurn", () => {
  it("parses the canonical format", () => {
    const r = parseNpcTurn(`<speech>\nHi there. Where are you on the offer?\n</speech>\n<moves>{"noticed":["good_question"],"reveal":["urgency_high"],"proposal":{"base":900000},"wantsToEnd":false}</moves>`);
    expect(r.speech).toBe("Hi there. Where are you on the offer?");
    expect(r.moves.noticed).toEqual(["good_question"]);
    expect(r.moves.reveal).toEqual(["urgency_high"]);
    expect(r.moves.proposal.base).toBe(900000);
    expect(r.problems).toEqual([]);
  });

  it("survives missing tags, broken JSON and stage directions", () => {
    const r1 = parseNpcTurn("Just plain text with no tags.");
    expect(r1.speech).toBe("Just plain text with no tags.");
    expect(r1.moves.noticed).toEqual([]);
    expect(r1.problems).toContain("no speech tag");

    const r2 = parseNpcTurn(`<speech>*smiles* Look, honestly, the band is fixed. (leans back)</speech><moves>{"noticed":["clear_ask","not_a_signal"],"proposal":{"base":"lots"},"wantsToEnd":"yes",</moves>`);
    expect(r2.speech).toBe("Look, honestly, the band is fixed.");
    expect(r2.moves.noticed).toEqual(["clear_ask"]);
    expect(r2.problems.some((p) => p.includes("moves"))).toBe(true);

    const r3 = parseNpcTurn("<speech></speech><moves>{}</moves>");
    expect(r3.speech).toBe("…");
    expect(r3.problems).toContain("empty speech");
  });

  it("drops unknown signals via schema and keeps valid ones", () => {
    const r = parseNpcTurn(`<speech>ok</speech><moves>{"noticed":["rapport"],"reveal":[],"proposal":{},"wantsToEnd":false}</moves>`);
    expect(r.moves.noticed).toEqual(["rapport"]);
  });
});

describe("extractStreamingSpeech", () => {
  it("surfaces speech incrementally and holds back partial tags", () => {
    expect(extractStreamingSpeech("<spe")).toEqual({ speech: "", speechDone: false });
    expect(extractStreamingSpeech("<speech>Hi the")).toEqual({ speech: "Hi the", speechDone: false });
    expect(extractStreamingSpeech("<speech>Hi there.</sp")).toEqual({ speech: "Hi there.", speechDone: false });
    expect(extractStreamingSpeech("<speech>Hi there.</speech><moves>{")).toEqual({ speech: "Hi there.", speechDone: true });
    expect(extractStreamingSpeech("<speech>Hi there.<moves>{")).toEqual({ speech: "Hi there.", speechDone: true });
  });
});

describe("cleanSpeech", () => {
  it("removes speaker labels and markdown-ish noise", () => {
    expect(cleanSpeech("Emma: Look, honestly.  *pauses*   That's fair.")).toBe("Look, honestly. That's fair.");
  });
});

describe("json extraction & repair", () => {
  const schema = z.object({ a: z.number(), b: z.array(z.string()) });

  it("extracts fenced and embedded JSON", () => {
    expect(extractJsonBlock('Here you go:\n```json\n{"a":1,"b":["x"]}\n```\nthanks')).toBe('{"a":1,"b":["x"]}');
    expect(extractJsonBlock('prefix {"a":1,"b":["x"]} suffix')).toBe('{"a":1,"b":["x"]}');
    expect(extractJsonBlock("no json here")).toBeNull();
  });

  it("repairs trailing commas, smart quotes and unterminated structures", () => {
    expect(JSON.parse(repairJson('{"a": 1, "b": ["x",],}'))).toEqual({ a: 1, b: ["x"] });
    expect(JSON.parse(repairJson('{“a”: 1, “b”: [“x”]}'))).toEqual({ a: 1, b: ["x"] });
    expect(JSON.parse(repairJson('{"a": 1, "b": ["x"'))).toEqual({ a: 1, b: ["x"] });
  });

  it("validates against the schema and reports useful errors", () => {
    const ok = parseJsonWithSchema('{"a": 1, "b": ["x"],}', schema);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.repaired).toBe(true);
    const bad = parseJsonWithSchema('{"a": "one", "b": []}', schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Schema mismatch: a:/);
  });
});
