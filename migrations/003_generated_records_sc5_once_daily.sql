-- SC5 is a once-per-day checklist (sc5.controller.js already checks this in application code
-- before generating a PDF), but that check-then-write has a race: two near-simultaneous
-- submissions can both pass the check before either write lands, producing two rows with the
-- same file_name for the same kitchen+day (observed in practice - duplicate SC5 entries in
-- the library, and deleting one wiped both since they shared a name). This partial unique
-- index makes Postgres itself the authoritative guard: a racing second INSERT now fails
-- outright rather than silently succeeding, and the app-level check remains as the normal,
-- friendly "already completed today" UX path.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_records_sc5_once_daily
    ON kiosk.generated_records (kitchen_id, record_date)
    WHERE record_type = 'SC5' AND deleted_at IS NULL;

COMMIT;
