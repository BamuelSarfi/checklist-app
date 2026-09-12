const { query } = require('../config/db');

function getKitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '');
}

// Generic replacement for the SC2/SC3/SC4 monthly-JSON files (SC2-YYYY-MM.json's `days`
// map, SC3/SC4-YYYY-MM.json's `entries` arrays). SC2 keeps one shared row per day
// (employeeId omitted/''), SC3/SC4 key per employee+day - callers pass whichever fits
// their existing keying, nothing here forces a single scheme.

async function listMonthEntries(recordType, year, month) {
  const result = await query(
    `SELECT day, employee_id, employee_name, payload, status, updated_at
     FROM checklist_drafts
     WHERE kitchen_id = $1 AND record_type = $2 AND year = $3 AND month = $4
     ORDER BY day ASC`,
    [getKitchenId(), recordType, year, month]
  );

  return result.rows;
}

async function getDraft(recordType, year, month, day, employeeId = '') {
  const result = await query(
    `SELECT day, employee_id, employee_name, payload, status, updated_at
     FROM checklist_drafts
     WHERE kitchen_id = $1 AND record_type = $2 AND year = $3 AND month = $4 AND day = $5 AND employee_id = $6`,
    [getKitchenId(), recordType, year, month, day, String(employeeId || '')]
  );

  return result.rows[0] || null;
}

async function upsertDraft({ recordType, year, month, day, employeeId = '', employeeName = null, payload, status = 'draft' }) {
  await query(
    `INSERT INTO checklist_drafts (
        kitchen_id, record_type, year, month, day, employee_id, employee_name, payload, status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (kitchen_id, record_type, year, month, day, employee_id) DO UPDATE SET
        employee_name = EXCLUDED.employee_name,
        payload = EXCLUDED.payload,
        status = EXCLUDED.status,
        updated_at = now()`,
    [getKitchenId(), recordType, year, month, day, String(employeeId || ''), employeeName, JSON.stringify(payload), status]
  );
}

async function deleteDraft(recordType, year, month, day, employeeId = '') {
  await query(
    `DELETE FROM checklist_drafts
     WHERE kitchen_id = $1 AND record_type = $2 AND year = $3 AND month = $4 AND day = $5 AND employee_id = $6`,
    [getKitchenId(), recordType, year, month, day, String(employeeId || '')]
  );
}

module.exports = {
  listMonthEntries,
  getDraft,
  upsertDraft,
  deleteDraft,
};
