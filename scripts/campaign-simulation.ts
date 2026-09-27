import { createTestDb } from "../src/db/client";
import { CAMPAIGN_PERSONAS, simulateCampaignPath } from "../src/server/campaign-simulation";
async function main() {
  const { db, client } = await createTestDb();
  const only = process.argv.find((a) => a.startsWith("--persona="))?.split("=")[1];
  try { for (const persona of CAMPAIGN_PERSONAS.filter((p) => !only || p === only)) {
    const { report } = await simulateCampaignPath(db, persona);
    console.log(JSON.stringify(process.argv.includes("--summary") ? { persona, played: report.played, optional: report.optional, recommendedBeforeClimax: report.recommendedBeforeClimax, failures: report.failures, path: report.ending?.path.join(" → "), professional: report.ending?.professional, identity: report.ending?.identity, headline: report.ending?.headline, moments: report.ending?.definingMoments.map((m) => m.label), people: report.ending?.relationships.map((r) => `${r.npcId}: ${r.outcome}`), weakness: report.ending?.weakness?.label, tease: report.ending?.tease?.title, information: report.information } : report, null, 2));
  } }
  finally { client.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
