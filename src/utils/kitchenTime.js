// Each kiosk container serves one kitchen, so its clock is set to that kitchen's time zone. Without
// this the container runs on UTC, and in British summer the first hour of each day was filed under
// the day before. Required first in server.js, before anything reads the time.
const DEFAULT_TIMEZONE = 'Europe/London';

function resolveTimezone(value) {
  const timezone = String(value || '').trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return timezone;
  } catch (_error) {
    console.warn(`Unknown KITCHEN_TIMEZONE "${timezone}", using ${DEFAULT_TIMEZONE}`);
    return DEFAULT_TIMEZONE;
  }
}

process.env.TZ = resolveTimezone(process.env.KITCHEN_TIMEZONE);

// YYYY-MM-DD for a date in the kitchen's time. toISOString() would give the UTC date instead.
function localDateIso(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

module.exports = { localDateIso, resolveTimezone };
