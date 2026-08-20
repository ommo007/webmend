import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, "..", "node_modules", ".bin", "brightdata");

/**
 * The CLI's own progress output (e.g. "Polling batch (attempt N/3600)",
 * repeated dozens of times) is useless as a diagnosis and can blow well past
 * Bright Data's 1000-char heal-prompt limit. Collapse repeated lines and
 * keep only the tail, which is where the actual error text lives.
 */
function condenseOutput(text, maxLen = 300) {
  const collapsed = text
    .replace(/(?:Polling(?: batch)? \(attempt \d+\/\d+\)\r?\n?)+/g, (m) => {
      const lines = m.trim().split(/\r?\n/);
      return `${lines[0]} ... [${lines.length} polling attempts] ... ${lines[lines.length - 1]}\n`;
    })
    .trim();
  return collapsed.length <= maxLen ? collapsed : `…${collapsed.slice(-maxLen)}`;
}

/**
 * Run a `brightdata` CLI subcommand and parse its JSON envelope.
 * All bdata calls in this project use --json so output is machine-readable.
 */
function run(args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [...args, "--json"], { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // fall through, use raw stdout/stderr below
      }
      if (code !== 0) {
        reject(
          new Error(
            `bdata ${args.join(" ")} exited ${code}: ${condenseOutput(stderr.trim() || stdout.trim())}`
          )
        );
        return;
      }
      resolve(parsed ?? { raw: stdout.trim() });
    });
  });
}

/** Build a scraper from a natural-language description. Returns { collector_id, ... }. */
export async function scraperCreate(url, description, { name } = {}) {
  const args = ["scraper", "create", url, description];
  if (name) args.push("--name", name);
  return run(args); // create can take 5-10 min; default timeout in run() covers it
}

/**
 * Run a scraper by collector ID against a URL. Returns the scrape result envelope.
 * Bright Data falls back to batch mode (up to 3600s of its own polling) when
 * the realtime page-load quota is exceeded, so our own kill timer needs
 * enough headroom not to cut that off mid-poll.
 */
export async function scraperRun(collectorId, url) {
  return run(["scraper", "run", collectorId, url], { timeoutMs: 65 * 60 * 1000 });
}

/** Heal a broken scraper in place. autoApprove/autoSave run it hands-free through the approval gate. */
export async function scraperHeal(collectorId, prompt, { autoApprove = true, autoSave = true } = {}) {
  const args = ["scraper", "heal", collectorId, prompt];
  if (autoApprove) args.push("--auto-approve");
  if (autoSave) args.push("--auto-save");
  return run(args);
}
