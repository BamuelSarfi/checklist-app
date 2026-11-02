const crypto = require('crypto');
const { query } = require('../config/db');

// A shared tablet is the normal case here, so sessions end quickly once nobody is using them: the
// next person shouldn't sign forms under the previous person's name.
const IDLE_MINUTES = 15;
const ABSOLUTE_HOURS = 12;
const TOUCH_INTERVAL_SECONDS = 60;

function getKitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '');
}

// Only a hash is stored, so reading this table doesn't hand anyone a working session.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession(employeeId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    'INSERT INTO kiosk_sessions (token_hash, kitchen_id, employee_id) VALUES ($1, $2, $3)',
    [hashToken(token), getKitchenId(), String(employeeId)]
  );

  // Kept tidy here rather than on a timer: kiosks can scale to zero, and a failure mustn't stop a login.
  query(
    `DELETE FROM kiosk_sessions WHERE created_at < now() - interval '2 days'`
  ).catch((err) => console.warn('Session cleanup failed:', err.message));

  return token;
}

async function isSessionValid(token, employeeId) {
  if (!token || !employeeId) {
    return false;
  }

  const result = await query(
    `SELECT id, last_seen_at < now() - ($5 || ' seconds')::interval AS needs_touch
     FROM kiosk_sessions
     WHERE token_hash = $1
       AND kitchen_id = $2
       AND employee_id = $3
       AND revoked_at IS NULL
       AND last_seen_at > now() - ($4 || ' minutes')::interval
       AND created_at > now() - ($6 || ' hours')::interval`,
    [hashToken(token), getKitchenId(), String(employeeId), String(IDLE_MINUTES), String(TOUCH_INTERVAL_SECONDS), String(ABSOLUTE_HOURS)]
  );

  const row = result.rows[0];
  if (!row) {
    return false;
  }

  if (row.needs_touch) {
    await query('UPDATE kiosk_sessions SET last_seen_at = now() WHERE id = $1', [row.id]);
  }

  return true;
}

async function revokeSession(token) {
  if (!token) {
    return;
  }

  await query('UPDATE kiosk_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

module.exports = {
  IDLE_MINUTES,
  ABSOLUTE_HOURS,
  createSession,
  isSessionValid,
  revokeSession,
};
