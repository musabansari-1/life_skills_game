import { expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { CAMPAIGN_PERSONAS, simulateCampaignPath } from "./campaign-simulation";
import { resolveEnding, CAREER_MILESTONES } from "@/engine/campaign";
import { campaignProgress } from "@/content/campaign";

it("nine personas play the whole season and do not live the same campaign", async () => {
  const { db, client } = await createTestDb();
  try {
    const paths = [];
    for (const persona of CAMPAIGN_PERSONAS) paths.push(await simulateCampaignPath(db, persona));
    const by = Object.fromEntries(paths.map((p) => [p.persona, p]));

    // Everyone reaches a frozen, personalized ending through the Review, whatever they did.
    for (const p of paths) {
      const w = p.state.world;
      expect(w.campaign.ending, p.persona).not.toBeNull();
      expect(w.campaign.ending!.resolvedBy).toBe(p.reviewAttemptId);
      expect(w.flags).toContain("season1.complete");
      expect(campaignProgress(w).finished).toBe(true);
      for (const id of CAREER_MILESTONES) expect(p.steps.some((s) => s.questId === id), `${p.persona} ${id}`).toBe(true);
      expect(p.steps.every((s) => !!s.attemptId)).toBe(true);
      // Deterministic and idempotent.
      expect(resolveEnding(w, p.state.competencies, p.state.npcs, p.reviewAttemptId)).toEqual(w.campaign.ending);
      await p.game.concludeQuest(p.playerId, p.reviewAttemptId);
      expect((await p.game.getPlayerState(p.playerId)).world).toEqual(w);
    }

    // Materially different journeys.
    const sequences = new Set(paths.map((p) => p.report.played.join(">")));
    expect(sequences.size).toBe(paths.length);
    expect(new Set(paths.map((p) => p.state.world.campaign.ending!.professional)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(paths.map((p) => p.state.world.campaign.ending!.identity)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(paths.map((p) => p.state.world.campaign.ending!.path.join(">"))).size).toBeGreaterThanOrEqual(4);
    expect(new Set(paths.map((p) => p.report.optional.join(","))).size).toBeGreaterThanOrEqual(3);

    // Strong play earns the lead trial; the Director fed them personalized events on the way.
    expect(by.strong.state.world.campaign.ending!.professional).toBe("Project lead trial");
    expect(by.strong.report.optional.length).toBeGreaterThanOrEqual(2);
    expect(by.strong.state.world.campaign.ending!.tease?.title).toContain("Leadership Tower");

    // Ignoring optional content still gives a complete, coherent season.
    expect(by.ignores_optional.report.optional).toEqual([]);
    expect(by.ignores_optional.state.world.campaign.ending!.professional).toBe("Project lead trial");

    // A weak player keeps playing: failures create alternate content, and the ending tells the truth.
    const weak = by.weak.state.world;
    expect(weak.campaign.failures.length).toBeGreaterThanOrEqual(4);
    expect(weak.flags).toEqual(expect.arrayContaining(["meridian.nora_owns", "chapter1.hid_incident", "nova_labs.rushed_migration"]));
    expect(weak.campaign.ending!.professional).toMatch(/narrower remit/i);
    expect(weak.campaign.ending!.path).toContain("Under Scrutiny");

    // Recovery is remembered as recovery, and can lead somewhere good.
    const rh = by.recovery_heavy.state.world;
    expect(rh.campaign.failures.filter((f) => f.recoveredBy).length).toBeGreaterThanOrEqual(3);
    expect(rh.campaign.ending!.identity).toBe("Accountability earned through recovery");
    expect(rh.campaign.ending!.professional).toBe("A second chance earned: trusted contributor");
    expect(rh.failedQuests.some((q) => q.questId === "recruiter_screening")).toBe(true); // the original failure survives

    // Aggressive: persuasive, and it costs them the customer call and the people mandate.
    expect(by.aggressive.state.world.flags).toContain("meridian.nora_owns");
    expect(by.aggressive.report.played).toContain("recovery_customer_escalation:repaired");
    expect(by.aggressive.state.world.campaign.ending!.professional).toBe("Specialist path, without a people mandate");
    expect(by.aggressive.state.world.campaign.ending!.identity).toBe("A strong negotiator still learning to listen");

    // The overcommitter's promises come back, one after another.
    const oc = by.overcommitter.state.world;
    expect(oc.flags).toEqual(expect.arrayContaining(["nova_labs.rushed_migration", "nora.dashboard_promised"]));
    expect(oc.campaign.milestones.project_crisis?.grade).toBe("failure");

    // The listener earns the room and never makes the ask: the lead role stays open.
    expect(by.listener.state.world.campaign.ending!.professional).toBe("Trusted contributor; the lead role is still open");

    // Relationships diverge with what was actually said.
    expect(by.strong.state.npcs.maya_sen.relationship.trust).toBeGreaterThan(by.weak.state.npcs.maya_sen.relationship.trust + 15);
    expect(by.strong.state.npcs.vikram_rao.relationship.trust).toBeGreaterThan(by.aggressive.state.npcs.vikram_rao.relationship.trust);
    expect(by.weak.state.world.campaign.communications.at(-1)?.kind).toBe("incident");
    expect(by.strong.state.world.campaign.communications.at(-1)?.kind).toBe("recommendation");

    // Recovery windows close: nobody is offered "Before Friday" after Friday.
    const cautious = by.cautious.state;
    expect(cautious.world.campaign.failures.some((f) => f.questId === "push_back_on_deadline" && !f.recoveredBy)).toBe(true);
  } finally { client.close(); }
}, 60000);
