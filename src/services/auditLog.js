const { query } = require('../config/db');

function getKitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '');
}

// Who changed a compliance record, and from what. Awaited by callers on purpose: for a deletion,
// failing to record it should stop the deletion rather than let it go unrecorded.
async function recordAudit({ action, recordType = null, recordDate = null, fileName = null, actor = null, details = {} }) {
  await query(
    `INSERT INTO record_audit_log (kitchen_id, action, record_type, record_date, file_name, actor_employee_id, actor_name, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      getKitchenId(),
      action,
      recordType,
      recordDate,
      fileName,
      actor?.id ? String(actor.id) : null,
      actor?.name || null,
      JSON.stringify(details),
    ]
  );
}

module.exports = { recordAudit };
