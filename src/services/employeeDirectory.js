const { createHash, randomBytes, scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
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
    can_sign_diary: employee.can_sign_diary === true,
  };
}

const scryptAsync = promisify(scrypt);
const LEGACY_SHA256_RE = /^[0-9a-f]{64}$/i;

// The portal said no more attempts for now. Kept distinct from "wrong PIN" so staff are told to
// wait, not sent off to get a PIN reset that wouldn't help.
class PinVerificationThrottledError extends Error {}

// The portal couldn't be reached, so a PIN can't be judged either way. Only raised for callers that
// ask, because telling someone a right PIN is wrong would be misleading when they're signing a record.
class PinVerificationUnavailableError extends Error {}

// Salted and deliberately slow, because there are only a million possible PINs: plain sha256 of one
// can be reversed instantly by anyone who reads this table.
async function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(String(pin), salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function bytesEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

async function pinMatchesHash(pin, hash) {
  const stored = String(hash || '');

  if (stored.startsWith('scrypt$')) {
    const [, saltHex, derivedHex] = stored.split('$');
    const derived = await scryptAsync(String(pin), Buffer.from(saltHex, 'hex'), 32);
    return bytesEqual(derived, Buffer.from(derivedHex, 'hex'));
  }

  // Rows from before scrypt. Upgraded on their next successful login (findCachedEmployeeByPin).
  if (LEGACY_SHA256_RE.test(stored)) {
    return bytesEqual(createHash('sha256').update(String(pin)).digest(), Buffer.from(stored, 'hex'));
  }

  return false;
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
    can_sign_diary: row.can_sign_diary,
  });
}

// Replaces records/employees.json - both as a write-through cache of the remote
// directory (see loadRemoteEmployees below) and as the store for employees on kitchens
// with no cloud connectivity configured at all (source = 'local', seeded directly in the
// database rather than by hand-editing a JSON file).
async function loadCachedEmployees() {
  const result = await query(
    `SELECT id, name, full_name, first_name, last_name, role, preferred_language, pin_last4, email, location, is_active, can_sign_diary
     FROM employees_cache
     WHERE kitchen_id = $1 AND is_active = true
     ORDER BY name ASC`,
    [getKitchenId()]
  );

  return result.rows.map(rowToEmployee);
}

async function findCachedEmployeeByPin(pin) {
  const result = await query(
    `SELECT id, name, full_name, first_name, last_name, role, preferred_language, pin_last4, pin_hash, email, location, is_active, can_sign_diary
     FROM employees_cache
     WHERE kitchen_id = $1 AND is_active = true AND pin_hash IS NOT NULL`,
    [getKitchenId()]
  );

  for (const row of result.rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await pinMatchesHash(pin, row.pin_hash)) {
      if (LEGACY_SHA256_RE.test(row.pin_hash)) {
        // eslint-disable-next-line no-await-in-loop
        await query('UPDATE employees_cache SET pin_hash = $1 WHERE id = $2', [await hashPin(pin), row.id]);
      }
      return rowToEmployee(row);
    }
  }

  return null;
}

async function cacheRemoteEmployees(employees) {
  const kitchenId = getKitchenId();

  for (const employee of employees) {
    try {
      await query(
        `INSERT INTO employees_cache (
            id, kitchen_id, name, full_name, first_name, last_name, role,
            preferred_language, pin_last4, email, location, is_active, can_sign_diary, source, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'remote', now())
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
            can_sign_diary = EXCLUDED.can_sign_diary,
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
          employee.can_sign_diary === true,
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
      const error = new Error(`Remote employee directory returned ${response.status}: ${body}`);
      error.status = response.status;
      throw error;
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

async function authenticateEmployeePin(pin, { reportOutage = false } = {}) {
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

      // The PIN check confirms who it is, but the directory has the full details, including the
      // role that decides what they can do. A wrong PIN never gets this far (it's a 401 above).
      const verified = normalizeEmployee(payload.employee);
      const details = await getEmployeeById(verified.id).catch(() => null);
      return details || verified;
    } catch (error) {
      if (error.status === 429) {
        throw new PinVerificationThrottledError('PIN verification is rate limited');
      }
      console.warn('Remote PIN verification unavailable, falling back to cache:', error.message);
      const cached = await findCachedEmployeeByPin(cleanPin);
      if (!cached && reportOutage && error.status !== 401) {
        throw new PinVerificationUnavailableError('The portal could not check this PIN');
      }
      return cached;
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
  PinVerificationThrottledError,
  PinVerificationUnavailableError,
};
