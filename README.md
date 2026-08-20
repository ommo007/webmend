# webmend

**Self-healing web scraper ops, built on [Bright Data Scraper Studio](https://brightdata.com).**

> You write a scraper, it works, and a week later the site changes its layout
> and everything breaks quietly.

`webmend` is a terminal-first ops tool that closes that loop automatically.
For every tracked target it:

1. Runs the target's Bright Data scraper (`bdata scraper run`) via its **Collector ID**.
2. Validates the result against the fields the scraper is supposed to extract.
3. If a field went missing or empty — the site's layout drifted — it writes a
   diagnosis of exactly what broke and hands it to **`bdata scraper heal`**
   (`--auto-approve --auto-save`), then re-runs to verify the fix worked.
4. Logs the run and the heal event to SQLite, which powers a terminal
   dashboard and a small web dashboard/API — both read-only downstream
   consumers of the same Collector ID data.

Built for the ["Into the Scrape-Verse"](https://www.wemakedevs.org/hackathons/scrape-verse)
hackathon (Web-Slinger track — Best Use of Bright Data).

## Why this design

Scraper Studio's self-heal isn't "automatic repair on failure" — `bdata scraper
heal <collector_id> <prompt>` takes a natural-language description of what's
broken. The interesting engineering problem isn't calling the CLI, it's
**deciding when to call it and what to tell it**: `webmend` diffs the expected
schema against what actually came back and turns that diff into the heal
prompt itself, so the whole loop runs unattended.

## Architecture

```
bright data scraper (create/run/heal)
        |
   webmend CLI  ──────────────►  SQLite (targets, runs, heal_events)
   (terminal, primary interface)         |
                                          ├── webmend status   (terminal dashboard)
                                          └── webmend serve    (API + web dashboard)
```

- `src/bdata.js` — thin wrapper shelling out to the local `@brightdata/cli` binary with `--json`.
- `src/db.js` — SQLite schema + queries (better-sqlite3).
- `src/watchdog.js` — the validate → diagnose → heal → re-verify loop.
- `src/cli.js` — the CLI itself (`add`, `run`, `run-all`, `watch`, `status`, `heals`, `history`).
- `src/server.js` + `public/index.html` — read-only API/dashboard, a downstream consumer of the Collector ID data.
- `demo-site/` — a small storefront we own and deploy to GitHub Pages
  (https://ommo007.github.io/gearnest-demo/), with two layouts (`v1`, `v2`)
  so we can break the page's markup on demand and show the heal loop live.

## Setup

```bash
npm install
npx brightdata login          # or: brightdata login --api-key <key>
```

Apply the hackathon promo code `wemakedevs` (lowercase) on your Bright Data
account first for the $50 credit tier.

## Usage

```bash
# Track a new target — this calls `bdata scraper create` (5-10 min AI build)
webmend add <name> <url> "<what to extract>" --fields field1,field2,...

# Run one target: validate output, auto-heal + verify if it drifted
webmend run <name>

# Run every tracked target
webmend run-all

# Scheduler: run every target on a fixed interval (downstream integration #3)
webmend watch --interval 300

# Terminal dashboard
webmend status

# Heal / run history for one target
webmend heals <name>
webmend history <name>

# API + web dashboard (downstream integration #4)
npm run serve   # http://localhost:4173
```

## Live self-heal demo

The demo storefront (`demo-site/`) starts on layout `v1`. To trigger a real
self-heal on camera:

```bash
cd demo-site
./deploy.sh v2   # redesigns the page: renamed classes, restructured price/stock markup
cd ..
webmend run gearnest-demo   # scraper fails validation -> auto-heals -> re-verifies
```

`v2` isn't a trivial CSS tweak — it moves price into split amount/cents/currency
spans and turns "in stock" from visible text into a `data-availability`
attribute, the kind of redesign that silently breaks selector-based scrapers
while looking fine to a human. `webmend run` catches the missing fields, writes
a diagnosis, and calls `bdata scraper heal` to re-derive the extraction logic
against the live page — same Collector ID throughout.

## Real-world target

`internshala-wfh` tracks live work-from-home internship listings on
[Internshala](https://internshala.com/internships/work-from-home-internships),
a public listings site not among Bright Data's 800+ pre-built scrapers —
proof the same loop holds up on a real, uncontrolled target, not just the
demo site.

## Rules compliance

- Only publicly available data (no login-walled or paywalled pages).
- `.env` / API tokens are never committed — Bright Data auth lives in the CLI's
  own config store outside this repo (see `.gitignore`).
- Primary interface is the terminal (`webmend` CLI); the API/dashboard is an
  explicitly optional downstream consumer of the same data.
