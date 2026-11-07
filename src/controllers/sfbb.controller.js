const path = require('path');
const diary = require('../services/sfbbDiary');
const kitchenConfig = require('../services/kitchenConfig');
const { syncStatusRecord } = require('../services/recordSync');
const { saveGeneratedRecord, listRecordsByTypeSince, retryUnsyncedRecords } = require('../services/generatedRecords');
const { recordAudit } = require('../services/auditLog');
const { authenticateEmployeePin, PinVerificationThrottledError, PinVerificationUnavailableError } = require('../services/employeeDirectory');
const { isManager } = require('../middleware/auth.middleware');
const { renderDiaryDay, renderReview, REVIEW_ROWS } = require('../lib/sfbbPdf');

const STATUS_RECORD_TYPES = { opening: 'SFBB_OPENING', closing: 'SFBB_CLOSING' };
const REVIEW_INTERVAL_DAYS = 28;
const RETRY_INTERVAL_MS = 60 * 1000;

function canSign(employee) {
  return isManager(employee) || employee?.can_sign_diary === true;
}

function safeName(name) {
  return String(name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
}

async function kitchenName() {
  const brand = await kitchenConfig.getKitchenName();
  return brand || 'Kitchen';
}

function isSection(value) {
  return value === 'opening' || value === 'closing';
}

async function pushSectionStatus(dateIso, section) {
  const day = await diary.loadDay(dateIso);
  const saved = day[section];
  if (!saved.completed_at || saved.synced_at) return;

  const { synced } = await syncStatusRecord({
    recordType: STATUS_RECORD_TYPES[section],
    recordDate: dateIso,
    employeeId: saved.completed_by_id,
    employeeName: saved.completed_by,
    payload: { completed_at: saved.completed_at, late: saved.late },
  });
  if (!synced) return;

  await diary.withDayLock(dateIso, async () => {
    const latest = await diary.loadDay(dateIso);
    latest[section].synced_at = new Date().toISOString();
    await diary.saveDay(dateIso, latest);
  });
}

// A check that never reached the portal would look missed to the manager. Retried when the diary or
// home screen is opened, so a portal outage clears itself.
let lastRetryAt = 0;
function retryUnsyncedStatus(todayIso) {
  if (Date.now() - lastRetryAt < RETRY_INTERVAL_MS) return;
  lastRetryAt = Date.now();
  const dates = [todayIso, diary.addDays(todayIso, -1)];
  Promise.all([
    ...dates.flatMap((date) => ['opening', 'closing'].map((section) => pushSectionStatus(date, section))),
    retryUnsyncedRecords(['SFBB_DIARY', 'SFBB_REVIEW']),
  ]).catch((error) => console.warn('Could not resend diary status', error.message));
}

async function context() {
  const config = await kitchenConfig.getKitchenConfig();
  return { config, today: diary.businessDate(new Date(), config.closing_time) };
}

function dayResponse(day, config, today, employee) {
  return {
    success: true,
    date: day.date,
    today,
    is_late: day.date < today,
    can_sign: canSign(employee),
    closing_time: config.closing_time,
    opening: diary.sectionView(day, 'opening', config),
    closing: diary.sectionView(day, 'closing', config),
    problems: day.problems,
    prove_it: day.prove_it,
    extra_checks: day.extra_checks,
    signoff: day.signoff,
    options: { extra_check_kinds: diary.EXTRA_CHECK_KINDS, prove_it_methods: diary.PROVE_IT_METHODS },
  };
}

function refuseSigned(res) {
  return res.status(409).json({ success: false, signed: true, error: 'This day has been signed and can no longer be changed.' });
}

exports.page = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sfbb_diary.html'));
};

exports.reviewPage = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sfbb_review.html'));
};

exports.getDay = async (req, res) => {
  try {
    const { config, today } = await context();
    const dateIso = req.query.date ? String(req.query.date) : today;
    if (!diary.isWritableDate(dateIso, today)) {
      return res.status(400).json({ success: false, error: 'That date is not available.' });
    }
    retryUnsyncedStatus(today);
    const day = await diary.loadDay(dateIso);
    const yesterday = await diary.loadDay(diary.addDays(today, -1));
    return res.json({
      ...dayResponse(day, config, today, req.employee),
      yesterday_unfinished: dateIso === today && yesterday.opening.completed_at && !yesterday.signoff
        ? diary.addDays(today, -1)
        : null,
    });
  } catch (error) {
    console.error('Could not load the diary', error);
    return res.status(500).json({ success: false, error: 'Could not load the diary.' });
  }
};

exports.completeSection = async (req, res) => {
  const { date, section, ticked, note, client_at: clientAt } = req.body || {};
  if (!isSection(section)) {
    return res.status(400).json({ success: false, error: 'Unknown section.' });
  }
  try {
    const { config, today } = await context();
    if (!diary.isWritableDate(date, today)) {
      return res.status(400).json({ success: false, error: 'That date is not available.' });
    }
    const outcome = await diary.withDayLock(date, async () => {
      const day = await diary.loadDay(date);
      if (day.signoff) return { signed: true };
      if (day[section].completed_at) return { already: true, day };

      const tickedSet = new Set(Array.isArray(ticked) ? ticked.map(String) : []);
      const items = diary.checksFor(section, config).map((text) => ({ text, done: tickedSet.has(text) }));
      const cleanedNote = diary.cleanNote(note);
      if (items.some((item) => !item.done) && !cleanedNote) return { needsNote: true };

      const at = diary.resolveEntryTime(clientAt);
      day[section] = {
        items,
        completed_at: at,
        received_at: new Date().toISOString(),
        completed_by: req.employee.name,
        completed_by_id: req.employee.id,
        late: date < today,
        synced_at: null,
      };
      if (cleanedNote) {
        day.problems.push({ text: cleanedNote, section, by: req.employee.name, by_id: req.employee.id, at });
      }
      await diary.saveDay(date, day);
      return { day };
    });

    if (outcome.signed) return refuseSigned(res);
    if (outcome.needsNote) {
      return res.status(400).json({ success: false, needs_note: true, error: 'Say what was wrong and what you did.' });
    }
    if (!outcome.already) {
      pushSectionStatus(date, section).catch((error) => console.warn('Could not send diary status', error.message));
    }
    return res.json(dayResponse(outcome.day, config, today, req.employee));
  } catch (error) {
    console.error('Could not save checks', error);
    return res.status(500).json({ success: false, error: 'Could not save the checks.' });
  }
};

async function appendEntry(req, res, listName, build) {
  const { date, client_at: clientAt } = req.body || {};
  try {
    const { config, today } = await context();
    if (!diary.isWritableDate(date, today)) {
      return res.status(400).json({ success: false, error: 'That date is not available.' });
    }
    const built = build();
    if (built.error) {
      return res.status(400).json({ success: false, error: built.error });
    }
    const outcome = await diary.withDayLock(date, async () => {
      const day = await diary.loadDay(date);
      if (day.signoff) return { signed: true };
      day[listName].push({ ...built.entry, by: req.employee.name, by_id: req.employee.id, at: diary.resolveEntryTime(clientAt) });
      await diary.saveDay(date, day);
      return { day };
    });
    if (outcome.signed) return refuseSigned(res);
    return res.json({ ...dayResponse(outcome.day, config, today, req.employee), warning: built.entry.warning || null });
  } catch (error) {
    console.error('Could not save diary entry', error);
    return res.status(500).json({ success: false, error: 'Could not save that entry.' });
  }
}

exports.addProblem = (req, res) => appendEntry(req, res, 'problems', () => {
  const text = diary.cleanNote(req.body?.text);
  return text ? { entry: { text } } : { error: 'Write what happened and what you did.' };
});

exports.addExtraCheck = (req, res) => appendEntry(req, res, 'extra_checks', () => {
  const kind = String(req.body?.kind || '');
  if (!diary.EXTRA_CHECK_KINDS.includes(kind)) return { error: 'Pick the type of check.' };
  const details = diary.cleanNote(req.body?.details);
  if (kind === 'Other' && !details) return { error: 'Say what the check was.' };
  return { entry: { kind, details } };
});

exports.addProveIt = (req, res) => appendEntry(req, res, 'prove_it', () => {
  const methodKey = String(req.body?.method || '');
  const method = diary.PROVE_IT_METHODS[methodKey];
  if (!method) return { error: 'Pick the safe method.' };
  const item = diary.cleanNote(req.body?.item).slice(0, 120);
  const details = diary.cleanNote(req.body?.details);
  const rawTemperature = req.body?.temperature;
  const temperature = rawTemperature === '' || rawTemperature == null ? NaN : Number(rawTemperature);
  if (rawTemperature !== '' && rawTemperature != null && (!Number.isFinite(temperature) || temperature < -60 || temperature > 300)) {
    return { error: 'Check the temperature.' };
  }
  const seconds = diary.holdSeconds(req.body?.hold_minutes, req.body?.hold_seconds);
  const text = diary.buildProveItText({ item, temperature, seconds, details });
  if (!text) return { error: 'Say how you proved it.' };
  return {
    entry: {
      method_key: methodKey,
      method,
      text,
      temperature: Number.isFinite(temperature) ? temperature : null,
      hold_seconds: seconds,
      warning: diary.proveItWarning(methodKey, temperature, seconds),
    },
  };
});

// Resolves the person from their PIN, so a manager can sign on whichever phone or tablet is to hand.
// A wrong PIN is a 403, not a 401: on this kiosk a 401 means the session has ended.
async function resolveSigner(req, res) {
  const pin = String(req.body?.pin || '').trim();
  if (!/^\d{6}$/.test(pin)) {
    res.status(400).json({ success: false, error: 'PIN must be 6 digits.' });
    return null;
  }
  try {
    const signer = await authenticateEmployeePin(pin, { reportOutage: true });
    if (!signer) {
      res.status(403).json({ success: false, wrong_pin: true, error: 'That PIN is not right.' });
      return null;
    }
    if (!canSign(signer)) {
      res.status(403).json({ success: false, not_allowed: true, error: 'Only a manager or a named delegate can sign.' });
      return null;
    }
    return signer;
  } catch (error) {
    if (error instanceof PinVerificationThrottledError) {
      res.status(429).json({ success: false, error: 'Too many attempts. Please wait a few minutes.' });
      return null;
    }
    if (error instanceof PinVerificationUnavailableError) {
      res.status(503).json({ success: false, error: 'We can\'t check PINs right now. Everything is saved, so please sign again shortly.' });
      return null;
    }
    throw error;
  }
}

exports.signDay = async (req, res) => {
  const date = req.body?.date;
  try {
    const { config, today } = await context();
    if (!diary.isWritableDate(date, today)) {
      return res.status(400).json({ success: false, error: 'That date is not available.' });
    }
    const signer = await resolveSigner(req, res);
    if (!signer) return undefined;

    const name = await kitchenName();
    const outcome = await diary.withDayLock(date, async () => {
      const day = await diary.loadDay(date);
      if (day.signoff) return { signed: true };
      if (!day.opening.completed_at || !day.closing.completed_at) return { incomplete: true };

      const signedAt = new Date().toISOString();
      day.signoff = { by: signer.name, by_id: signer.id, role: signer.role, at: signedAt, late: date < today };
      const pdf = await renderDiaryDay({ day, kitchenName: name });
      const fileName = `SFBB_DIARY-${date}-${safeName(signer.name)}-${Date.now()}.pdf`;
      await saveGeneratedRecord({
        fileName,
        recordType: 'SFBB_DIARY',
        recordDate: date,
        employeeId: signer.id,
        employeeName: signer.name,
        payload: day,
        pdfBuffer: pdf,
      });
      day.signoff.file_name = fileName;
      await diary.saveDay(date, day);
      await recordAudit({ action: 'diary_signed', recordType: 'SFBB_DIARY', recordDate: date, fileName, actor: signer, details: { session_employee_id: req.employee.id, late: day.signoff.late } });
      return { day };
    });

    if (outcome.signed) return refuseSigned(res);
    if (outcome.incomplete) {
      return res.status(400).json({ success: false, incomplete: true, error: 'Finish the opening and closing checks first.' });
    }
    return res.json(dayResponse(outcome.day, config, today, req.employee));
  } catch (error) {
    console.error('Could not sign the diary', error);
    return res.status(500).json({ success: false, error: 'Could not sign the diary. Please try again.' });
  }
};

async function reviewStatus(today) {
  const reviews = await listRecordsByTypeSince('SFBB_REVIEW');
  const lastDate = reviews[0]?.record_date || null;
  const started = await diary.firstDiaryDate();
  const base = lastDate || started;
  const dueDate = base ? diary.addDays(base, REVIEW_INTERVAL_DAYS) : null;
  return { last_date: lastDate, due_date: dueDate, is_due: Boolean(dueDate && dueDate <= today) };
}

exports.reviewStatus = reviewStatus;

exports.getReview = async (req, res) => {
  try {
    const { today } = await context();
    const status = await reviewStatus(today);
    const days = await diary.listDaysBetween(diary.addDays(today, -REVIEW_INTERVAL_DAYS), today);
    const problems = days.flatMap((day) => (day.problems || []).map((problem) => ({ date: day.date, text: problem.text })));
    return res.json({ success: true, today, ...status, recent_problems: problems, questions: REVIEW_ROWS.map(([key, label]) => ({ key, label })), can_sign: canSign(req.employee) });
  } catch (error) {
    console.error('Could not load the review', error);
    return res.status(500).json({ success: false, error: 'Could not load the review.' });
  }
};

exports.submitReview = async (req, res) => {
  const body = req.body || {};
  try {
    const { today } = await context();
    if (typeof body.problems_observed !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Answer whether you saw any problems.' });
    }
    const problemDetails = diary.cleanNote(body.problem_details);
    const problemAction = diary.cleanNote(body.problem_action);
    if (body.problems_observed && (!problemDetails || !problemAction)) {
      return res.status(400).json({ success: false, error: 'Say what the problem was and what you did.' });
    }
    const answers = {};
    for (const [key] of REVIEW_ROWS) {
      if (typeof body.answers?.[key] !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Answer every question.' });
      }
      answers[key] = body.answers[key];
    }
    const signer = await resolveSigner(req, res);
    if (!signer) return undefined;

    const review = {
      date: today,
      problems_observed: body.problems_observed,
      problem_details: problemDetails,
      problem_action: problemAction,
      answers,
      additional_details: diary.cleanNote(body.additional_details),
      signed_by: signer.name,
      signed_by_id: signer.id,
      signed_at: new Date().toISOString(),
    };
    const pdf = await renderReview({ review, kitchenName: await kitchenName() });
    const fileName = `SFBB_REVIEW-${today}-${safeName(signer.name)}-${Date.now()}.pdf`;
    await saveGeneratedRecord({ fileName, recordType: 'SFBB_REVIEW', recordDate: today, employeeId: signer.id, employeeName: signer.name, payload: review, pdfBuffer: pdf });
    await recordAudit({ action: 'review_signed', recordType: 'SFBB_REVIEW', recordDate: today, fileName, actor: signer, details: { session_employee_id: req.employee.id } });
    return res.json({ success: true, ...(await reviewStatus(today)) });
  } catch (error) {
    console.error('Could not save the review', error);
    return res.status(500).json({ success: false, error: 'Could not save the review. Please try again.' });
  }
};

// What the home screen needs. Also the moment to resend anything that failed to reach the portal.
exports.homeStatus = async () => {
  const { today } = await context();
  retryUnsyncedStatus(today);
  const day = await diary.loadDay(today);
  const review = await reviewStatus(today);
  return {
    sfbb_opening: Boolean(day.opening.completed_at),
    sfbb_closing: Boolean(day.closing.completed_at),
    sfbb_signoff: Boolean(day.signoff),
    sfbb_review_due: review.is_due,
  };
};
