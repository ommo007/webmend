import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listTargets,
  latestRunForEachTarget,
  allHealEvents,
  runsForTarget,
  healEventsForTarget,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.static(path.join(__dirname, "..", "public")));

// Downstream consumer of the tracked Collector IDs: everything here reads
// from SQLite, which is populated by `webmend run` calling the Bright Data
// scraper via its collector_id. Nothing here talks to Bright Data directly.
app.get("/api/status", (_req, res) => {
  const targets = listTargets();
  const latestRuns = new Map(latestRunForEachTarget().map((r) => [r.target_name, r]));
  const heals = allHealEvents(30);

  res.json({
    targets: targets.map((t) => ({
      name: t.name,
      url: t.url,
      description: t.description,
      collectorId: t.collector_id,
      requiredFields: t.required_fields,
      latestRun: latestRuns.get(t.name) ?? null,
    })),
    healEvents: heals,
  });
});

app.get("/api/targets/:name/runs", (req, res) => {
  res.json(runsForTarget(req.params.name, 50));
});

app.get("/api/targets/:name/heals", (req, res) => {
  res.json(healEventsForTarget(req.params.name, 50));
});

app.listen(PORT, () => {
  console.log(`webmend dashboard: http://localhost:${PORT}`);
});
