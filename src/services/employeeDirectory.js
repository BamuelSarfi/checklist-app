const { createHash, timingSafeEqual } = require('crypto');
const { query } = require('../config/db');

function hasRemoteDirectory() {
  return Boolean(
    process.env.SAFECATER_BASE_API_URL &&
    process.env.SAFECATER_KITCHEN_ID &&
    process.env.SAFECATER_SERVICE_API_KEY
  );
}

function getRemoteBaseUrl() {
  return String(process.env.SAFECATER_BASE_API_URL || '').replace(/\/$/, '');
}

function getKitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '');
}

function normalizeEmployee(employee) {
  if (!employee) {
    return null;
  }

  const firstName = String(employee.first_name || '').trim();
  const lastName = String(employee.last_name || '').trim();
  const name = String(employee.name || `${firstName} ${lastName}`.trim() || employee.full_name || 'Employee').trim();

  return {
    id: employee.id,
    name,
    full_name: employee.full_name || name,
    first_name: firstName,
    last_name: lastName,
    role: employee.role || employee.preferred_language || 'Employee',
    preferred_language: employee.preferred_language || 'en',
    pin_last4: employee.pin_last4 || null,
    email: employee.email || null,
    location: employee.location || null,
    is_active: employee.is_active !== false,
  };
}

// PINs are 6-digit codes, not user passwords - sha256 is here to avoid storing them in
// cleartext in the database (the old records/employees.json file did, and CLAUDE.md
// flagged it as sensitive enough to need walling off from static serving). It isn't a
// substitute for rate-limiting PIN attempts, which the login route already does.
function hashPin(pin) {
  return createHash('sha256').update(String(pin)).digest('hex');
}

function pinMatchesHash(pin, hash) {
  if (!hash) {
    return false;
  }

  const a = Buffer.from(hashPin(pin), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function rowToEmployee(row) {
  if (!row) {
    return null;
  }

  return normalizeEmployee({
    id: row.id,
    name: row.name,
    full_name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    preferred_language: row.preferred_language,
    pin_last4: row.pin_last4,
    email: row.email,
    location: row.location,
    is_active: row.is_active,
  });
}

// Replaces records/employees.json - both as a write-through cache of the remote
// directory (see loadRemoteEmployees below) and as the store for employees on kitchens
// with no cloud connectivity configured at all (source = 'local', seeded directly in the
// database rather than by hand-editing a JSON file).
async function loadCachedEmployees() {
  const result = await query(
    `SELECT id, name, full_name, first_name, last_name, role, preferred_language, pin_last4, email, location, is_active
     FROM employees_cache
     WHERE kitchen_id = $1 AND is_active = true
     ORDER BY name ASC`,
    [getKitchenId()]
  );

  return result.rows.map(rowToEmployee);
}

async function findCachedEmployeeByPin(pin) {
  const result = await query(
    `SELECT id, name, full_name, first_name, last_name, role, preferred_language, pin_last4, pin_hash, email, location, is_active
     FROM employees_cache
     WHERE kitchen_id = $1 AND is_active = true AND pin_hash IS NOT NULL`,
    [getKitchenId()]
  );

  const match = result.rows.find((row) => pinMatchesHash(pin, row.pin_hash));
  return rowToEmployee(match);
}

async function cacheRemoteEmployees(employees) {
  const kitchenId = getKitchenId();

  for (const employee of employees) {
    try {
      await query(
        `INSERT INTO employees_cache (
            id, kitchen_id, name, full_name, first_name, last_name, role,
            preferred_language, pin_last4, email, location, is_active, source, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'remote', now())
         ON CONFLICT (id) DO UPDATE SET
            kitchen_id = EXCLUDED.kitchen_id,
            name = EXCLUDED.name,
            full_name = EXCLUDED.full_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            role = EXCLUDED.role,
            preferred_language = EXCLUDED.preferred_language,
            pin_last4 = EXCLUDED.pin_last4,
            email = EXCLUDED.email,
            location = EXCLUDED.location,
            is_active = EXCLUDED.is_active,
            source = 'remote',
            updated_at = now()`,
        [
          String(employee.id),
          kitchenId,
          employee.name,
          employee.full_name,
          employee.first_name,
          employee.last_name,
          employee.role,
          employee.preferred_language,
          employee.pin_last4,
          employee.email,
          employee.location,
          employee.is_active,
        ]
      );
    } catch (error) {
      console.warn('Failed to cache employee', employee.id, error.message);
    }
  }

  // An employee removed/deactivated on the remote directory just stops appearing in this
  // payload - without this, their cached row stays is_active=true forever, so if the remote
  // directory later becomes briefly unreachable, the offline fallback (loadCachedEmployees /
  // findCachedEmployeeByPin) would still treat a terminated employee as active. Skipped on an
  // empty payload as a safety net - a transient empty/malformed response shouldn't be able to
  // mass-deactivate every cached employee for this kitchen.
  if (employees.length > 0) {
    const currentIds = employees.map((employee) => String(employee.id));
    try {
      await query(
        `UPDATE employees_cache
         SET is_active = false, updated_at = now()
         WHERE kitchen_id = $1 AND source = 'remote' AND is_active = true AND NOT (id = ANY($2))`,
        [kitchenId, currentIds]
      );
    } catch (error) {
      console.warn('Failed to deactivate stale cached employees', error.message);
    }
  }
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Remote employee directory returned ${response.status}: ${body}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRemoteEmployees() {
  const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(process.env.SAFECATER_KITCHEN_ID)}/employees/sync?limit=200`;
  const payload = await fetchJson(url, {
    headers: {
      'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
    },
  });

  const employees = Array.isArray(payload.employees) ? payload.employees.map(normalizeEmployee) : [];
  await cacheRemoteEmployees(employees);
  return employees;
}

async function loadEmployees() {
  if (hasRemoteDirectory()) {
    try {
      return await loadRemoteEmployees();
    } catch (error) {
      console.warn('Remote employee directory unavailable, falling back to cache:', error.message);
    }
  }

  return loadCachedEmployees();
}

async function getEmployeeById(employeeId) {
  const employees = await loadEmployees();
  return employees.find((employee) => String(employee.id) === String(employeeId)) || null;
}

async function authenticateEmployeePin(pin) {
  const cleanPin = String(pin || '').trim();

  if (!/^\d{6}$/.test(cleanPin)) {
    return null;
  }

  if (hasRemoteDirectory()) {
    try {
      const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(process.env.SAFECATER_KITCHEN_ID)}/employees/verify-pin`;
      const payload = await fetchJson(url, {
        method: 'POST',
        headers: {
          'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
        },
        body: JSON.stringify({ pin: cleanPin }),
      });

      return normalizeEmployee(payload.employee);
    } catch (error) {
      console.warn('Remote PIN verification unavailable, falling back to cache:', error.message);
    }
  }

  return findCachedEmployeeByPin(cleanPin);
}

module.exports = {
  loadEmployees,
  getEmployeeById,
  authenticateEmployeePin,
  normalizeEmployee,
  hashPin,
};
