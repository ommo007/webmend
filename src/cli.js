#!/usr/bin/env node
import { Command } from "commander";
import { scraperCreate } from "./bdata.js";
import {
  upsertTarget,
  getTarget,
  listTargets,
  latestRunForEachTarget,
  healEventsForTarget,
  allHealEvents,
  runsForTarget,
} from "./db.js";
import { runAndHeal } from "./watchdog.js";

const program = new Command();
program
  .name("webmend")
  .description(
    "Self-healing web scraper ops CLI, built on Bright Data Scraper Studio.\n" +
      "Tracks scrape targets, validates output against expected schemas, and\n" +
      "auto-heals scrapers when a site's layout drifts."
  );

program
  .command("add <name> <url> <description>")
  .description("Create a new Bright Data scraper and start tracking it")
  .requiredOption(
    "--fields <fields>",
    "Comma-separated list of required fields the scraper must extract per record (e.g. title,price,url)"
  )
  .action(async (name, url, description, opts) => {
    const requiredFields = opts.fields.split(",").map((f) => f.trim()).filter(Boolean);
    console.log(`Building scraper for "${name}" against ${url} ...`);
    console.log("(AI generation typically takes 5-10 minutes)");
    const result = await scraperCreate(url, description, { name });
    const collectorId = result.collector_id;
    if (!collectorId) {
      console.error("No collector_id returned:", JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    upsertTarget({ name, url, description, collectorId, requiredFields });
    console.log(`Tracked "${name}" -> collector_id=${collectorId}`);
  });

program
  .command("run <name>")
  .description("Run a tracked target's scraper, validate output, and auto-heal if it drifted")
  .action(async (name) => {
    const target = getTarget(name);
    if (!target) {
      console.error(`Unknown target "${name}". Run "webmend list" to see tracked targets.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Running "${name}" (collector_id=${target.collector_id}) ...`);
    const result = await runAndHeal(target);
    printRunResult(name, result);
  });

program
  .command("run-all")
  .description("Run every tracked target, healing any that drifted")
  .action(async () => {
    for (const target of listTargets()) {
      console.log(`\n--- ${target.name} ---`);
      const result = await runAndHeal(target);
      printRunResult(target.name, result);
    }
  });

program
  .command("watch")
  .description("Scheduler: run every tracked target on a fixed interval, forever (Ctrl+C to stop)")
  .option("--interval <seconds>", "Seconds between run-all cycles", "300")
  .action(async (opts) => {
    const intervalMs = Number(opts.interval) * 1000;
    console.log(`Scheduler started — running all targets every ${opts.interval}s.`);
    const cycle = async () => {
      const startedAt = new Date().toISOString();
      console.log(`\n=== scheduled cycle @ ${startedAt} ===`);
      for (const target of listTargets()) {
        console.log(`--- ${target.name} ---`);
        const result = await runAndHeal(target);
        printRunResult(target.name, result);
      }
    };
    await cycle();
    setInterval(cycle, intervalMs);
  });

program
  .command("list")
  .description("List tracked targets")
  .action(() => {
    const targets = listTargets();
    if (targets.length === 0) {
      console.log("No targets tracked yet. Use `webmend add` to create one.");
      return;
    }
    for (const t of targets) {
      console.log(`${t.name}\t${t.collector_id}\t${t.url}`);
    }
  });

program
  .command("status")
  .description("Terminal dashboard: latest run status per target + recent heal events")
  .action(() => {
    const targets = listTargets();
    const latestRuns = new Map(latestRunForEachTarget().map((r) => [r.target_name, r]));

    console.log("TARGET".padEnd(20), "STATUS".padEnd(10), "RECORDS".padEnd(9), "LAST RUN");
    console.log("-".repeat(60));
    for (const t of targets) {
      const run = latestRuns.get(t.name);
      const status = run ? run.status : "never run";
      const records = run?.record_count ?? "-";
      const when = run?.created_at ?? "-";
      console.log(t.name.padEnd(20), String(status).padEnd(10), String(records).padEnd(9), when);
    }

    const heals = allHealEvents(10);
    if (heals.length > 0) {
      console.log("\nRecent self-heal events:");
      for (const h of heals) {
        console.log(
          `  [${h.created_at}] ${h.target_name}: ${h.heal_status.toUpperCase()} — ${h.reason}`
        );
      }
    }
  });

program
  .command("heals <name>")
  .description("Show heal history for a target")
  .action((name) => {
    const events = healEventsForTarget(name);
    for (const h of events) {
      console.log(`[${h.created_at}] ${h.heal_status.toUpperCase()} — ${h.reason}`);
      console.log(`  prompt: ${h.prompt}`);
    }
  });

program
  .command("history <name>")
  .description("Show run history for a target")
  .action((name) => {
    const runs = runsForTarget(name);
    for (const r of runs) {
      console.log(`[${r.created_at}] ${r.status.toUpperCase()} records=${r.record_count ?? "-"}`);
      if (r.error) console.log(`  error: ${r.error}`);
    }
  });

function printRunResult(name, result) {
  switch (result.status) {
    case "ok":
      console.log(`OK — ${result.recordCount} records extracted cleanly.`);
      break;
    case "healed":
      console.log(`HEALED — scraper drifted (${result.reason})`);
      console.log(`  Self-heal repaired it. ${result.recordCount} records extracted after heal.`);
      break;
    case "heal_incomplete":
      console.log(`HEAL INCOMPLETE — scraper drifted (${result.reason})`);
      console.log(`  Heal ran but verification still failed. Check "webmend heals ${name}".`);
      break;
    case "heal_failed":
      console.log(`HEAL FAILED — ${result.reason}`);
      console.log(`  ${result.error}`);
      break;
  }
}

program.parseAsync(process.argv);
