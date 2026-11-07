const checklistDrafts = require('./checklistDrafts');
const { query } = require('../config/db');
const { localDateIso } = require('../utils/kitchenTime');

const RECORD_TYPE = 'SFBB_DAY';
const OVERNIGHT_CUTOFF_MINUTES = 6 * 60;
const MAX_NOTE_LENGTH = 1000;
const OLDEST_WRITABLE_DAYS = 7;

// Wording from the Safer Food, Better Business for Caterers pack, under the Open Government Licence.
const OPENING_CHECKS = [
  'Your fridges, chilled display equipment and freezers are working properly.',
  'Your other equipment (e.g. oven) is working properly.',
  'Staff are fit for work and wearing clean work clothes.',
  'Food preparation areas are clean and disinfected (work surfaces, equipment, utensils, etc.).',
  'All areas are free from evidence of pest activity.',
  'There are plenty of handwashing and cleaning materials (soap, paper towels, sanitiser, etc.).',
  'Hot running water is available at all sinks and hand wash basins.',
  'Probe thermometer is working and probe wipes are available.',
  'Allergen information is accurate for all items on sale.',
];

const CLOSING_CHECKS = [
  'All food is covered, labelled and put in the fridge/freezer (where appropriate).',
  'Food on its Use By date has been thrown away.',
  'Dirty cleaning equipment has been cleaned or thrown away.',
  'Waste has been removed and new bags put into the bins.',
  'Food preparation areas are clean and disinfected (work surfaces, equipment, utensils etc.).',
  'All washing up has been finished.',
  'Floors are swept and clean.',
  '‘Prove it’ checks have been recorded.',
];

const EXTRA_CHECK_KINDS = ['Deep clean', 'Maintenance', 'Dishwasher', 'Temperature probe', 'Pest control', 'Other'];

// Limits the pack gives for each method. Cooking also depends on how long the food was held.
const COOKING_COMBINATIONS = [
  { temperature: 80, seconds: 6 },
  { temperature: 75, seconds: 30 },
  { temperature: 70, seconds: 120 },
  { temperature: 65, seconds: 600 },
  { temperature: 60, seconds: 2700 },
];
const PROVE_IT_METHODS = {
  cooking: 'Cooking',
  reheating: 'Reheating',
  fridge: 'Fridge check',
  hot_holding: 'Hot holding',
  cooling: 'Cooling',
  cleaning: 'Cleaning',
  other: 'Other',
};

// A kitchen that closes after midnight is still on yesterday's diary until 6am.
function businessDate(now = new Date(), closingTime = '22:00') {
  const [hours, minutes] = String(closingTime).split(':').map(Number);
  const closingMinutes = hours * 60 + minutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (closingMinutes < OVERNIGHT_CUTOFF_MINUTES && nowMinutes < OVERNIGHT_CUTOFF_MINUTES) {
    const previous = new Date(now);
    previous.setDate(previous.getDate() - 1);
    return localDateIso(previous);
  }
  return localDateIso(now);
}

function addDays(dateIso, days) {
  const [year, month, day] = dateIso.split('-').map(Number);
  return localDateIso(new Date(year, month - 1, day + days));
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function isWritableDate(dateIso, todayIso) {
  return isRealDate(dateIso) && dateIso <= todayIso && dateIso >= addDays(todayIso, -OLDEST_WRITABLE_DAYS);
}

function emptySection() {
  return { items: [], completed_at: null, completed_by: null, completed_by_id: null, late: false, synced_at: null };
}

function emptyDay(dateIso) {
  return {
    date: dateIso,
    opening: emptySection(),
    closing: emptySection(),
    problems: [],
    prove_it: [],
    extra_checks: [],
    signoff: null,
  };
}

async function loadDay(dateIso) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const row = await checklistDrafts.getDraft(RECORD_TYPE, year, month, day, '');
  return row?.payload ? { ...emptyDay(dateIso), ...row.payload } : emptyDay(dateIso);
}

async function saveDay(dateIso, payload) {
  const [year, month, day] = dateIso.split('-').map(Number);
  await checklistDrafts.upsertDraft({ recordType: RECORD_TYPE, year, month, day, employeeId: '', payload, status: payload.signoff ? 'signed' : 'draft' });
}

// Staff share one diary page per day, and each kitchen has one kiosk process, so running writes for a
// day one after another is enough to stop two people overwriting each other.
const dayQueues = new Map();
function withDayLock(dateIso, task) {
  const previous = dayQueues.get(dateIso) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const settled = run.catch(() => {}).finally(() => {
    if (dayQueues.get(dateIso) === settled) dayQueues.delete(dateIso);
  });
  dayQueues.set(dateIso, settled);
  return run;
}

function checksFor(section, config) {
  const defaults = section === 'opening' ? OPENING_CHECKS : CLOSING_CHECKS;
  const custom = config?.custom_checks?.[section] || [];
  return [...new Set([...defaults, ...custom])];
}

// A finished section keeps the wording it was done against, so later edits can't rewrite history.
function sectionView(day, section, config) {
  const saved = day[section];
  if (saved.completed_at) return saved;
  return { ...saved, items: checksFor(section, config).map((text) => ({ text, done: false })) };
}

function cleanNote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
}

// Offline entries replay later, so they carry when they really happened. Only a past time within the
// writable window is believed, and the time we received it is always kept beside it.
function resolveEntryTime(clientAt, now = new Date()) {
  const parsed = clientAt ? new Date(clientAt) : null;
  const oldest = now.getTime() - OLDEST_WRITABLE_DAYS * 24 * 60 * 60 * 1000;
  if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime() && parsed.getTime() >= oldest) {
    return parsed.toISOString();
  }
  return now.toISOString();
}

function holdSeconds(minutes, seconds) {
  const total = Number(minutes || 0) * 60 + Number(seconds || 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

// Returns why a reading is outside the pack's limits, or null when it's fine or can't be judged.
function proveItWarning(method, temperature, seconds) {
  if (!Number.isFinite(temperature)) return null;
  if (method === 'fridge' && temperature > 8) return 'Chilled food must be 8°C or below.';
  if (method === 'hot_holding' && temperature < 63) return 'Hot food must be held at 63°C or above.';
  if (method === 'cooking' || method === 'reheating') {
    // With no hold time given, 75°C is the point the pack treats as safe straight away.
    const met = seconds === null
      ? temperature >= 75
      : COOKING_COMBINATIONS.some((combo) => temperature >= combo.temperature && seconds >= combo.seconds);
    if (!met) return 'Below the safe cooking temperature and time.';
  }
  return null;
}

function buildProveItText({ item, temperature, seconds, details }) {
  const parts = [];
  if (item) parts.push(item);
  if (Number.isFinite(temperature)) parts.push(`${temperature}°C`);
  if (seconds) parts.push(seconds >= 60 ? `held ${Math.round(seconds / 60)} min` : `held ${seconds} sec`);
  if (details) parts.push(details);
  return parts.join(', ');
}

async function listDaysBetween(fromIso, toIso) {
  const result = await query(
    `SELECT payload FROM checklist_drafts
     WHERE kitchen_id = $1 AND record_type = $2
       AND make_date(year, month, day) BETWEEN $3::date AND $4::date
     ORDER BY year, month, day`,
    [String(process.env.SAFECATER_KITCHEN_ID || ''), RECORD_TYPE, fromIso, toIso]
  );
  return result.rows.map((row) => row.payload);
}

async function firstDiaryDate() {
  const result = await query(
    `SELECT MIN(make_date(year, month, day)) AS first_date FROM checklist_drafts
     WHERE kitchen_id = $1 AND record_type = $2`,
    [String(process.env.SAFECATER_KITCHEN_ID || ''), RECORD_TYPE]
  );
  const value = result.rows[0]?.first_date;
  return value ? localDateIso(new Date(value)) : null;
}

module.exports = {
  RECORD_TYPE,
  OPENING_CHECKS,
  CLOSING_CHECKS,
  EXTRA_CHECK_KINDS,
  PROVE_IT_METHODS,
  businessDate,
  addDays,
  isRealDate,
  isWritableDate,
  loadDay,
  saveDay,
  withDayLock,
  checksFor,
  sectionView,
  cleanNote,
  resolveEntryTime,
  holdSeconds,
  proveItWarning,
  buildProveItText,
  listDaysBetween,
  firstDiaryDate,
};
