import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "webmend.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS targets (
  name TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  description TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  required_fields TEXT NOT NULL, -- JSON array of field names expected in each record
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'ok' | 'failed' | 'healed'
  record_count INTEGER,
  error TEXT,
  data TEXT, -- JSON snapshot of scraped records
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (target_name) REFERENCES targets(name)
);

CREATE TABLE IF NOT EXISTS heal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_name TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  reason TEXT NOT NULL, -- what was broken (missing fields etc.)
  prompt TEXT NOT NULL, -- prompt sent to bdata scraper heal
  heal_status TEXT NOT NULL, -- 'success' | 'failed'
  verify_record_count INTEGER,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (target_name) REFERENCES targets(name)
);
`);

export function upsertTarget({ name, url, description, collectorId, requiredFields }) {
  db.prepare(
    `INSERT INTO targets (name, url, description, collector_id, required_fields)
     VALUES (@name, @url, @description, @collectorId, @requiredFields)
     ON CONFLICT(name) DO UPDATE SET
       url=excluded.url, description=excluded.description,
       collector_id=excluded.collector_id, required_fields=excluded.required_fields`
  ).run({
    name,
    url,
    description,
    collectorId,
    requiredFields: JSON.stringify(requiredFields),
  });
}

export function getTarget(name) {
  const row = db.prepare(`SELECT * FROM targets WHERE name = ?`).get(name);
  if (!row) return null;
  return { ...row, required_fields: JSON.parse(row.required_fields) };
}

export function listTargets() {
  return db
    .prepare(`SELECT * FROM targets ORDER BY name`)
    .all()
    .map((row) => ({ ...row, required_fields: JSON.parse(row.required_fields) }));
}

export function recordRun({ targetName, status, recordCount, error, data }) {
  const info = db
    .prepare(
      `INSERT INTO runs (target_name, status, record_count, error, data)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(targetName, status, recordCount ?? null, error ?? null, data ? JSON.stringify(data) : null);
  return info.lastInsertRowid;
}

export function recordHealEvent({
  targetName,
  collectorId,
  reason,
  prompt,
  healStatus,
  verifyRecordCount,
  rawResponse,
}) {
  db.prepare(
    `INSERT INTO heal_events (target_name, collector_id, reason, prompt, heal_status, verify_record_count, raw_response)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    targetName,
    collectorId,
    reason,
    prompt,
    healStatus,
    verifyRecordCount ?? null,
    rawResponse ? JSON.stringify(rawResponse) : null
  );
}

export function latestRunForEachTarget() {
  return db
    .prepare(
      `SELECT r.* FROM runs r
       INNER JOIN (
         SELECT target_name, MAX(id) AS max_id FROM runs GROUP BY target_name
       ) latest ON r.target_name = latest.target_name AND r.id = latest.max_id`
    )
    .all();
}

export function healEventsForTarget(targetName, limit = 20) {
  return db
    .prepare(`SELECT * FROM heal_events WHERE target_name = ? ORDER BY id DESC LIMIT ?`)
    .all(targetName, limit);
}

export function allHealEvents(limit = 50) {
  return db.prepare(`SELECT * FROM heal_events ORDER BY id DESC LIMIT ?`).all(limit);
}

export function runsForTarget(targetName, limit = 20) {
  return db
    .prepare(`SELECT * FROM runs WHERE target_name = ? ORDER BY id DESC LIMIT ?`)
    .all(targetName, limit);
}
