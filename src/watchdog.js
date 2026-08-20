import { scraperRun, scraperHeal } from "./bdata.js";
import { recordRun, recordHealEvent } from "./db.js";

/**
 * A record is "valid" if it has every required field set to a non-null,
 * non-empty value. This is deliberately simple: it's the same signal a
 * human skimming the JSON would use to notice a scraper drifted.
 */
function validateRecords(records, requiredFields) {
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, reason: "No records returned (empty result set)." };
  }
  const missingByField = {};
  for (const field of requiredFields) missingByField[field] = 0;

  for (const record of records) {
    for (const field of requiredFields) {
      const value = record?.[field];
      const isEmpty = value === null || value === undefined || value === "";
      if (isEmpty) missingByField[field] += 1;
    }
  }

  const brokenFields = Object.entries(missingByField)
    .filter(([, count]) => count > 0)
    .map(([field, count]) => `${field} (missing in ${count}/${records.length} records)`);

  if (brokenFields.length > 0) {
    return {
      ok: false,
      reason: `Fields not extracting correctly: ${brokenFields.join(", ")}.`,
    };
  }
  return { ok: true };
}

function extractRecords(runResult) {
  if (Array.isArray(runResult)) return runResult;
  if (Array.isArray(runResult?.data)) return runResult.data;
  if (Array.isArray(runResult?.result)) return runResult.result;
  return [];
}

/**
 * Run a target's scraper, validate the output against its expected schema,
 * and — if it drifted — auto-heal it in place and re-verify before giving up.
 * Returns a summary the caller can print/log.
 */
export async function runAndHeal(target) {
  const { name, url, collector_id: collectorId, required_fields: requiredFields } = target;

  let runResult;
  let records;
  try {
    runResult = await scraperRun(collectorId, url);
    records = extractRecords(runResult);
  } catch (err) {
    // A hard failure (e.g. selector throws / page structure broke badly) is
    // itself a heal trigger, using the error text as the diagnosis.
    return healThenVerify(target, `The scraper run itself failed: ${err.message}`);
  }

  const validation = validateRecords(records, requiredFields);
  if (validation.ok) {
    recordRun({ targetName: name, status: "ok", recordCount: records.length, data: records });
    return { status: "ok", recordCount: records.length };
  }

  recordRun({
    targetName: name,
    status: "failed",
    recordCount: records.length,
    error: validation.reason,
    data: records,
  });

  return healThenVerify(target, validation.reason);
}

async function healThenVerify(target, reason) {
  const { name, url, collector_id: collectorId, required_fields: requiredFields, description } = target;

  const prompt = `${reason} Expected each record to include: ${requiredFields.join(
    ", "
  )}. Original extraction goal: ${description}. Re-inspect the live page at ${url} and fix the selectors/extraction logic so these fields populate correctly again.`;

  let healResult;
  try {
    healResult = await scraperHeal(collectorId, prompt, { autoApprove: true, autoSave: true });
  } catch (err) {
    recordHealEvent({
      targetName: name,
      collectorId,
      reason,
      prompt,
      healStatus: "failed",
      rawResponse: { error: err.message },
    });
    return { status: "heal_failed", reason, error: err.message };
  }

  // Verify: re-run the (now healed) scraper and check the schema again.
  let verifyRecords = [];
  let verifyOk = false;
  try {
    const verifyRun = await scraperRun(collectorId, url);
    verifyRecords = extractRecords(verifyRun);
    verifyOk = validateRecords(verifyRecords, requiredFields).ok;
  } catch {
    verifyOk = false;
  }

  recordHealEvent({
    targetName: name,
    collectorId,
    reason,
    prompt,
    healStatus: verifyOk ? "success" : "failed",
    verifyRecordCount: verifyRecords.length,
    rawResponse: healResult,
  });

  if (verifyOk) {
    recordRun({
      targetName: name,
      status: "healed",
      recordCount: verifyRecords.length,
      data: verifyRecords,
    });
    return { status: "healed", recordCount: verifyRecords.length, reason };
  }

  return { status: "heal_incomplete", reason, healResult };
}
