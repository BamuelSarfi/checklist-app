-- checklist_drafts.record_type was hard-limited to SC2/SC3/SC4, which would reject draft
-- rows for any future non-SafeCatering module's forms (see
-- docs/module_and_language_research.md audit). Dropped rather than replaced with a wider
-- CHECK list, matching how generated_records.record_type and compliance_records.record_type
-- (checklist-app-fend) are already unconstrained free text - no real second-module form
-- names exist yet to enumerate.
BEGIN;

ALTER TABLE IF EXISTS kiosk.checklist_drafts
    DROP CONSTRAINT IF EXISTS checklist_drafts_record_type_check;

COMMIT;
