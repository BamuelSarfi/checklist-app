const crypto = require('crypto');
const { query, getPool } = require('../config/db');

function getKitchenId() {
    return String(process.env.SAFECATER_KITCHEN_ID || '');
}

// Only one till for now (see migration 004's comment) - fixed rather than configurable
// until there's a second counter to actually support.
const DEFAULT_TILL_ID = 'till-1';

// Phone numbers are never stored in plaintext (see migration 004) - normalize first so the
// same real number always hashes the same way regardless of formatting (spaces, +44 vs 0,
// etc.), otherwise "has this number already claimed" silently fails to catch a re-entry
// typed slightly differently the second time.
function normalizePhone(phone) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    // UK numbers: treat a leading 44 (with or without a stripped +) the same as a leading 0,
    // so "07700900461" and "447700900461" hash identically.
    if (digits.startsWith('44')) {
        return `0${digits.slice(2)}`;
    }
    return digits;
}

function hashPhone(phone) {
    return crypto.createHash('sha256').update(normalizePhone(phone)).digest('hex');
}

function last4(phone) {
    const digits = normalizePhone(phone);
    return digits.slice(-4);
}

async function createVerification({ firstName, phone, optedIn }) {
    const result = await query(
        `INSERT INTO tester_verifications (kitchen_id, first_name, phone_hash, phone_last4, opted_in, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, status, created_at`,
        [getKitchenId(), firstName, hashPhone(phone), last4(phone), Boolean(optedIn)]
    );

    return result.rows[0];
}

async function attachWamid(verificationId, wamid) {
    await query('UPDATE tester_verifications SET wamid = $1 WHERE id = $2', [wamid, verificationId]);
}

// Called from the webhook (whatsappService.js) once Meta reports a definitive delivery
// outcome for the template message sent at registration time.
async function resolveVerificationByWamid(wamid, status) {
    const result = await query(
        `UPDATE tester_verifications
         SET status = $2, resolved_at = now()
         WHERE wamid = $1 AND status = 'pending'
         RETURNING id, kitchen_id, status`,
        [wamid, status]
    );

    return result.rows[0] || null;
}

// Marking failed directly (not via a webhook) - used when the initial send call itself
// fails synchronously (bad number format, Meta rejects it outright), so the customer isn't
// left waiting the full poll timeout for a webhook that will never arrive.
async function markVerificationFailed(verificationId) {
    await query(
        `UPDATE tester_verifications SET status = 'failed', resolved_at = now() WHERE id = $1 AND status = 'pending'`,
        [verificationId]
    );
}

// Only used when WhatsApp isn't configured yet (no WHATSAPP_* env vars) - lets the rest of
// the claim flow be built and exercised end-to-end before real Meta credentials exist. Real
// verifications are only ever resolved via resolveVerificationByWamid (the actual webhook).
async function markVerificationSimulatedVerified(verificationId) {
    await query(
        `UPDATE tester_verifications SET status = 'verified', resolved_at = now() WHERE id = $1 AND status = 'pending'`,
        [verificationId]
    );
}

async function getVerification(verificationId) {
    const result = await query(
        `SELECT id, kitchen_id, first_name, phone_hash, phone_last4, opted_in, status, consumed_at, created_at
         FROM tester_verifications WHERE id = $1`,
        [verificationId]
    );

    return result.rows[0] || null;
}

async function createRun({ testerName, stock, startsAt, endsAt, staffEmployeeId, staffName, tillId = DEFAULT_TILL_ID }) {
    const result = await query(
        `INSERT INTO tester_runs (kitchen_id, till_id, tester_name, stock, starts_at, ends_at, staff_employee_id, staff_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'live')
         RETURNING *`,
        [getKitchenId(), tillId, testerName, stock, startsAt, endsAt, staffEmployeeId || null, staffName]
    );

    return result.rows[0];
}

async function getLiveRun(tillId = DEFAULT_TILL_ID) {
    const result = await query(
        `SELECT * FROM tester_runs WHERE kitchen_id = $1 AND till_id = $2 AND status = 'live' ORDER BY created_at DESC LIMIT 1`,
        [getKitchenId(), tillId]
    );

    return result.rows[0] || null;
}

async function getRunById(runId) {
    const result = await query('SELECT * FROM tester_runs WHERE id = $1', [runId]);
    return result.rows[0] || null;
}

async function endRun(runId) {
    const result = await query(
        `UPDATE tester_runs SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'live' RETURNING *`,
        [runId]
    );

    return result.rows[0] || null;
}

async function getClaimCount(runId) {
    const result = await query('SELECT COUNT(*)::int AS count FROM tester_claims WHERE run_id = $1', [runId]);
    return result.rows[0].count;
}

async function listRecentClaims(runId, limit = 10) {
    const result = await query(
        `SELECT id, first_name, claimed_at FROM tester_claims WHERE run_id = $1 ORDER BY claimed_at DESC LIMIT $2`,
        [runId, limit]
    );

    return result.rows;
}

// The actual "moment of contact" - a transaction so the stock/dedup checks and the insert
// are atomic. UNIQUE(run_id, phone_hash) is the real double-claim guard (see migration 004);
// the explicit existence check here just lets us return the friendlier "already claimed,
// here's when" response instead of a raw constraint-violation error.
async function claimTester({ verificationId, tillId = DEFAULT_TILL_ID }) {
    const pool = getPool();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const verificationResult = await client.query(
            `SELECT id, phone_hash, first_name, status, consumed_at FROM tester_verifications WHERE id = $1 FOR UPDATE`,
            [verificationId]
        );
        const verification = verificationResult.rows[0];

        if (!verification || verification.status !== 'verified') {
            await client.query('ROLLBACK');
            return { outcome: 'not_verified' };
        }

        if (verification.consumed_at) {
            // Already used for a claim before (e.g. the customer scanned twice) - fall
            // through to the "already claimed" branch below using the existing claim row,
            // rather than a generic error.
        }

        const runResult = await client.query(
            `SELECT * FROM tester_runs WHERE kitchen_id = $1 AND till_id = $2 AND status = 'live' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [getKitchenId(), tillId]
        );
        const run = runResult.rows[0];

        if (!run) {
            await client.query('ROLLBACK');
            return { outcome: 'no_live_run' };
        }

        const nowMinutes = (() => {
            const now = new Date();
            return now.getHours() * 60 + now.getMinutes();
        })();
        const toMinutes = (hhmm) => {
            const [h, m] = String(hhmm).split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        };
        const startMinutes = toMinutes(run.starts_at);
        const endMinutes = toMinutes(run.ends_at);
        const inWindow = endMinutes >= startMinutes
            ? nowMinutes >= startMinutes && nowMinutes <= endMinutes
            : nowMinutes >= startMinutes || nowMinutes <= endMinutes; // window spans midnight

        if (!inWindow) {
            await client.query('ROLLBACK');
            return { outcome: 'outside_window' };
        }

        const existingClaim = await client.query(
            `SELECT id, first_name, claimed_at FROM tester_claims WHERE run_id = $1 AND phone_hash = $2`,
            [run.id, verification.phone_hash]
        );

        if (existingClaim.rows[0]) {
            await client.query('ROLLBACK');
            return { outcome: 'already_claimed', claim: existingClaim.rows[0], run };
        }

        const claimedCountResult = await client.query('SELECT COUNT(*)::int AS count FROM tester_claims WHERE run_id = $1', [run.id]);
        if (claimedCountResult.rows[0].count >= run.stock) {
            await client.query('ROLLBACK');
            return { outcome: 'sold_out' };
        }

        const insertResult = await client.query(
            `INSERT INTO tester_claims (run_id, verification_id, phone_hash, first_name, till_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, first_name, claimed_at`,
            [run.id, verification.id, verification.phone_hash, verification.first_name, tillId]
        );

        await client.query('UPDATE tester_verifications SET consumed_at = now() WHERE id = $1', [verification.id]);

        await client.query('COMMIT');
        return { outcome: 'success', claim: insertResult.rows[0], run };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    DEFAULT_TILL_ID,
    hashPhone,
    normalizePhone,
    createVerification,
    attachWamid,
    resolveVerificationByWamid,
    markVerificationFailed,
    markVerificationSimulatedVerified,
    getVerification,
    createRun,
    getLiveRun,
    getRunById,
    endRun,
    getClaimCount,
    listRecentClaims,
    claimTester,
};
