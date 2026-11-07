const { query } = require('../config/db');

const FRESH_MS = 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 15 * 1000;
const PORTAL_TIMEOUT_MS = 3000;

const DEFAULT_CONFIG = {
  module_type: 'safecatering',
  addon_forms: [],
  closing_time: '22:00',
  custom_checks: { opening: [], closing: [] },
};

let current = null;
let checkAgainAt = 0;

function kitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '').trim();
}

function fromBrand(kitchen) {
  return {
    kitchen_name: kitchen?.name || null,
    module_type: kitchen?.module_type || DEFAULT_CONFIG.module_type,
    addon_forms: Array.isArray(kitchen?.addon_forms) ? kitchen.addon_forms : [],
    closing_time: kitchen?.closing_time || DEFAULT_CONFIG.closing_time,
    custom_checks: {
      opening: Array.isArray(kitchen?.custom_checks?.opening) ? kitchen.custom_checks.opening : [],
      closing: Array.isArray(kitchen?.custom_checks?.closing) ? kitchen.custom_checks.closing : [],
    },
  };
}

async function fetchFromPortal() {
  const base = String(process.env.SAFECATER_BASE_API_URL || '').replace(/\/$/, '');
  const url = `${base}/api/v1/tenant/${encodeURIComponent(kitchenId())}/brand`;
  const response = await fetch(url, {
    headers: { 'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Portal returned ${response.status}`);
  }
  const brand = await response.json();
  return fromBrand(brand.kitchen);
}

async function readSaved() {
  const result = await query('SELECT payload FROM kitchen_config_cache WHERE kitchen_id = $1', [kitchenId()]);
  return result.rows[0]?.payload || null;
}

async function save(config) {
  await query(
    `INSERT INTO kitchen_config_cache (kitchen_id, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (kitchen_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
    [kitchenId(), JSON.stringify(config)]
  );
}

// The kitchen's pack settings: from the portal when it answers, otherwise the last ones it sent.
async function getKitchenConfig() {
  if (current && Date.now() < checkAgainAt) {
    return current;
  }

  if (!process.env.SAFECATER_BASE_API_URL || !kitchenId() || !process.env.SAFECATER_SERVICE_API_KEY) {
    current = DEFAULT_CONFIG;
    checkAgainAt = Date.now() + FRESH_MS;
    return current;
  }

  try {
    current = await fetchFromPortal();
    checkAgainAt = Date.now() + FRESH_MS;
    await save(current).catch((error) => console.warn('Could not save kitchen settings', error.message));
  } catch (error) {
    console.warn('Could not reach the portal for kitchen settings', error.message);
    current = current || await readSaved().catch(() => null) || DEFAULT_CONFIG;
    checkAgainAt = Date.now() + RETRY_AFTER_FAILURE_MS;
  }

  return current;
}

async function getKitchenName() {
  return (await getKitchenConfig()).kitchen_name || null;
}

module.exports = { getKitchenConfig, getKitchenName };
