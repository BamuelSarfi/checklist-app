const FRIDGE_ALERT_THRESHOLD_C = 8;
const COOK_REHEAT_ALERT_THRESHOLD_C = 75;

function hasRemoteRecordSync() {
  return Boolean(
    process.env.SAFECATER_BASE_API_URL &&
    process.env.SAFECATER_KITCHEN_ID &&
    process.env.SAFECATER_SERVICE_API_KEY
  );
}

function getRemoteBaseUrl() {
  return String(process.env.SAFECATER_BASE_API_URL || '').replace(/\/$/, '');
}

function buildAnomalousFridgeReadings(unitNames, temperatures) {
  const readings = [];

  for (const [key, rawValue] of Object.entries(temperatures || {})) {
    const tempC = parseFloat(rawValue);
    if (isNaN(tempC) || tempC <= FRIDGE_ALERT_THRESHOLD_C) continue;

    // key shape: unit{n}_am / unit{n}_pm
    const match = key.match(/^unit(\d+)_(am|pm)$/);
    const unitNumber = match ? match[1] : null;
    const slot = match ? match[2].toUpperCase() : key;

    readings.push({
      unit_name: (unitNumber && unitNames?.[unitNumber]) || (unitNumber ? `Unit ${unitNumber}` : key),
      slot,
      temp_c: tempC,
    });
  }

  return readings;
}

// Shared HTTP call to the portal's tenant temperature-alert endpoint. Best-effort and
// non-blocking in the sense that it never throws - callers await it for timing (the manager
// alert must land before the draft's dedup flag is set), but a failure here must never
// surface as a saveDraft error, same contract as recordSync.js. `alertContext` lets each
// caller phrase the email accurately (SC2's fridge readings are "above 8°C", SC3's
// cooking/reheating readings are "below 75°C" - the opposite direction) without the portal
// having to guess from the readings alone.
async function postTemperatureAlert({ recordDate, employeeName, readings, alertType, alertContext }) {
  if (!hasRemoteRecordSync()) {
    return { sent: false, reason: 'disabled' };
  }

  if (!readings || readings.length === 0) {
    return { sent: false, reason: 'no_anomalous_readings' };
  }

  try {
    const kitchenId = String(process.env.SAFECATER_KITCHEN_ID || '').trim();
    const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(kitchenId)}/temperature-alert`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        record_date: recordDate,
        employee_name: employeeName || 'Employee',
        readings,
        alert_type: alertType,
        alert_context: alertContext,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Temperature alert request failed with ${response.status}: ${body}`);
    }

    const payload = await response.json().catch(() => ({}));
    return { sent: Boolean(payload.sent), reason: payload.reason || null };
  } catch (error) {
    console.warn('Temperature alert notification to SafeCater backend failed:', error.message);
    return { sent: false, reason: 'error', message: error.message };
  }
}

// SC2 fridge/freezer alert: readings above 8°C.
async function notifyTemperatureAlert({ recordDate, employeeName, unitNames, temperatures }) {
  const readings = buildAnomalousFridgeReadings(unitNames, temperatures);
  return postTemperatureAlert({
    recordDate,
    employeeName,
    readings,
    alertType: 'fridge',
    alertContext: 'reading above 8°C',
  });
}

// SC3 cooking/reheating alert: core temperatures below 75°C (the opposite direction from
// SC2's fridge alert - food must reach at least 75°C when cooked or reheated). Callers build
// `readings` themselves ({ unit_name, slot, temp_c }[], already filtered to anomalous
// entries) since SC3's food-item/step naming doesn't fit the SC2 unit-number parsing scheme.
async function notifyCookingTemperatureAlert({ recordDate, employeeName, readings }) {
  return postTemperatureAlert({
    recordDate,
    employeeName,
    readings,
    alertType: 'cooking_reheat',
    alertContext: 'core temperature below 75°C',
  });
}

module.exports = {
  notifyTemperatureAlert,
  notifyCookingTemperatureAlert,
};
