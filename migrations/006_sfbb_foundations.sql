-- Foundations for Safer Food, Better Business kitchens.
SET search_path TO kiosk, public;

-- Who may sign the daily diary when the manager is away. Mirrors the portal, so sign-off still
-- works while the portal is unreachable.
ALTER TABLE employees_cache
    ADD COLUMN IF NOT EXISTS can_sign_diary boolean NOT NULL DEFAULT false;

-- The last pack settings the portal sent. Without this, an outage would drop an SFBB kitchen back
-- to the Safe Catering forms.
CREATE TABLE IF NOT EXISTS kitchen_config_cache (
    kitchen_id text PRIMARY KEY,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
