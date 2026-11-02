-- Kiosk security audit, 2026-11. Sessions move server-side, because a signed cookie alone can't be
-- revoked: it kept working after logout for its full 24 hours. Compliance records also get an
-- append-only history, because who deleted or re-signed a record was previously lost for good.
SET search_path TO kiosk, public;

CREATE TABLE IF NOT EXISTS kiosk_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    kitchen_id text NOT NULL DEFAULT '',
    employee_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_last_seen ON kiosk_sessions (last_seen_at);

CREATE TABLE IF NOT EXISTS record_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_id text NOT NULL DEFAULT '',
    action text NOT NULL,
    record_type text,
    record_date text,
    file_name text,
    actor_employee_id text,
    actor_name text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_record_audit_log_kitchen ON record_audit_log (kitchen_id, created_at DESC);

-- The portal stopped sending PIN digits (portal migration 025). Rows for staff who have since left
-- never get overwritten by a sync, so they'd otherwise keep them.
UPDATE employees_cache SET pin_last4 = NULL WHERE pin_last4 IS NOT NULL;
