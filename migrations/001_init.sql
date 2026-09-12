CREATE SCHEMA IF NOT EXISTS kiosk;
SET search_path TO kiosk, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Write-through cache of the SafeCater tenant employee directory, plus a place for
-- manually-provisioned employees on kitchens with no cloud connectivity configured at all.
-- Replaces records/employees.json. pin_hash is only ever populated for the latter case -
-- the remote directory never exposes a full PIN to this app (only pin_last4), so
-- remote-synced rows leave it null and simply can't authenticate a PIN while offline.
CREATE TABLE IF NOT EXISTS employees_cache (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL DEFAULT '',
    name text,
    full_name text,
    first_name text,
    last_name text,
    role text,
    preferred_language text,
    pin_last4 text,
    pin_hash text,
    email text,
    location text,
    is_active boolean NOT NULL DEFAULT true,
    source text NOT NULL DEFAULT 'remote' CHECK (source IN ('remote', 'local')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Replaces the SC2/SC3/SC4 monthly-JSON draft files (SC2-YYYY-MM.json's `days` map,
-- SC3-YYYY-MM.json/SC4-YYYY-MM.json's `entries` arrays). One row per day per form; SC2
-- currently keeps one shared row per day (employee_id left as ''), SC3/SC4 key per
-- employee+day - preserved as-is rather than forcing every form onto the same scheme.
CREATE TABLE IF NOT EXISTS checklist_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_id text NOT NULL DEFAULT '',
    record_type text NOT NULL CHECK (record_type IN ('SC2', 'SC3', 'SC4')),
    year int NOT NULL,
    month int NOT NULL,
    day int NOT NULL,
    employee_id text NOT NULL DEFAULT '',
    employee_name text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'draft',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kitchen_id, record_type, year, month, day, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_drafts_month
    ON checklist_drafts (kitchen_id, record_type, year, month);

-- Replaces both the locally-written PDF file and records/.safecater-sync.json. One row per
-- finalized SC1/SC3/SC4/SC5 PDF. fend_storage_key/fend_record_id are populated once the
-- existing best-effort mirror to checklist-app-fend succeeds (see recordSync.js) - a null
-- value there just means that mirror hasn't landed yet, not that the record is unsaved
-- (the PDF is already durably in R2 via r2_key at that point).
CREATE TABLE IF NOT EXISTS generated_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_id text NOT NULL DEFAULT '',
    record_type text NOT NULL,
    record_date text NOT NULL,
    employee_id text,
    employee_name text,
    file_name text NOT NULL,
    r2_key text NOT NULL,
    fend_storage_key text,
    fend_record_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_generated_records_file_name ON generated_records (file_name);
CREATE INDEX IF NOT EXISTS idx_generated_records_kitchen_type_date
    ON generated_records (kitchen_id, record_type, record_date);
