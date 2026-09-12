-- Tester Promotion (Naa Tester Claim) - business-specific bolt-on, same pattern as
-- Uncle's Market's own checklist (see checklistDrafts.js's record_type extension point) but
-- with its own tables rather than reusing checklist_drafts, since the shape here (a run with
-- stock/claims, not a per-day form draft) genuinely doesn't fit that schema.
SET search_path TO kiosk, public;

-- One row per shift's tester run. Only one till supported for now (till_id defaults to a
-- fixed value) - the column exists so multi-till support later doesn't need a schema change,
-- just a UI to pick/create more till identities.
CREATE TABLE IF NOT EXISTS tester_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_id text NOT NULL DEFAULT '',
    till_id text NOT NULL DEFAULT 'till-1',
    tester_name text NOT NULL,
    stock int NOT NULL,
    starts_at text NOT NULL,
    ends_at text NOT NULL,
    run_date date NOT NULL DEFAULT CURRENT_DATE,
    staff_employee_id text,
    staff_name text NOT NULL,
    status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tester_runs_live
    ON tester_runs (kitchen_id, till_id, status);

-- One row per customer registration attempt on the Naa Tester Claim app. The phone number
-- is never stored in plaintext - only a SHA-256 hash (for equality checks: has this number
-- already claimed / already verified) and the last 4 digits (for display, e.g. "confirm
-- 07xxx xxx 461" style UX without holding the full number at rest). wamid is the WhatsApp
-- message ID returned when the verification template send succeeds - Meta's delivery-status
-- webhook references it, which is how a 'pending' row here gets resolved to
-- 'verified'/'failed' asynchronously.
CREATE TABLE IF NOT EXISTS tester_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_id text NOT NULL DEFAULT '',
    first_name text NOT NULL,
    phone_hash text NOT NULL,
    phone_last4 text NOT NULL,
    opted_in boolean NOT NULL DEFAULT false,
    wamid text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tester_verifications_wamid
    ON tester_verifications (wamid);

-- The UNIQUE(run_id, phone_hash) constraint is the actual "two tills can't double-issue"
-- guarantee - not application logic, the database itself rejects a second insert for the
-- same number on the same run, so a race between two near-simultaneous scans of the same
-- number can only ever produce one successful claim row.
CREATE TABLE IF NOT EXISTS tester_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES tester_runs(id) ON DELETE CASCADE,
    verification_id uuid REFERENCES tester_verifications(id),
    phone_hash text NOT NULL,
    first_name text,
    till_id text NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, phone_hash)
);

CREATE INDEX IF NOT EXISTS idx_tester_claims_run
    ON tester_claims (run_id, claimed_at DESC);
