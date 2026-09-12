const fillSc3Entry = require('../lib/fillSc3');
const { getEmployeeById } = require('../services/employeeDirectory');
const { saveGeneratedRecord } = require('../services/generatedRecords');
const checklistDrafts = require('../services/checklistDrafts');
const temperatureAlerts = require('../services/temperatureAlerts');

// Core temperature must be AT LEAST this when cooking or reheating - unlike SC2's fridge
// alert (anomaly = too high), an SC3 anomaly is a reading BELOW this threshold.
const CORE_TEMP_ALERT_THRESHOLD_C = 75;

async function resolveEmployee(req) {
    if (req.employee) {
        return req.employee;
    }

    const employeeId = req.signedCookies?.employeeId;
    if (!employeeId) {
        return null;
    }

    return getEmployeeById(employeeId);
}

exports.getTodayData = async (req, res) => {
  try {
    const employee = await resolveEmployee(req);

    if (!employee) {
      return res.json({
        success: false,
        message: 'Employee not authenticated'
      });
    }

    const today = new Date();
    const day = today.getDate();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();

    let data = null;

    const draft = await checklistDrafts.getDraft('SC3', Number(year), Number(month), day, employee.id);
    if (draft) {
      const entry = draft.payload || {};
      data = {
        cooking: entry.cooking || [],
        cooling: entry.cooling || [],
        reheating: entry.reheating || [],
        comments: entry.comments || ''
      };
    }

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Error getting today data:', err);
    res.json({
      success: false,
      message: 'Error getting data: ' + err.message
    });
  }
};

// Cooking/reheating are independent lists in the UI (a kitchen might log 3 cooking events and
// 1 reheating event on a given day, unrelated to each other), but the PDF template has ONE
// shared pool of 17 numbered rows (row_1..row_17, each with cooking_*/cooling_*/reheating_*
// fields - see fillSc3.js's normalizeRows). Each entry gets its own row, allocated
// sequentially (cooking first, then cooling, then reheating) - never zipped together by
// index, which would merge unrelated events (e.g. cooking row 2 and cooling row 2, logged for
// different foods at different times) into one nonsensical PDF line.
function buildSc3Payload(body = {}, employee = {}) {
    const cooking = Array.isArray(body.cooking) ? body.cooking : [];
    const cooling = Array.isArray(body.cooling) ? body.cooling : [];
    const reheating = Array.isArray(body.reheating) ? body.reheating : [];
    const signature = employee.initial || employee.name || '';

    const rows = [];

    cooking.forEach((c) => {
        rows.push({
            date: c.date || '',
            food: c.food || '',
            time_started_cooking: c.time_start || '',
            time_finished_cooking: c.time_end || '',
            core_temp: c.temp ?? '',
            cooking_sign: c.sign || signature,
        });
    });

    cooling.forEach((co) => {
        rows.push({
            cooling_date: co.date || '',
            time_into_fridge: co.time || '',
            cooling_sign: co.sign || signature,
        });
    });

    reheating.forEach((r) => {
        rows.push({
            reheating_date: r.date || '',
            reheating_core_temp: r.temp ?? '',
            reheating_sign: r.sign || signature,
        });
    });

    // The single "Comments for Today" field isn't tied to any one section - attach it to
    // whichever row ends up first overall.
    if (rows.length > 0 && body.comments) {
        rows[0].comment = body.comments;
    }

    return {
        employee_name: employee.name || employee.full_name || 'Employee',
        rows,
    };
}

function findLowCoreTempReadings(cooking, reheating) {
    const readings = [];

    (cooking || []).forEach((row) => {
        const tempC = parseFloat(row.temp);
        if (!isNaN(tempC) && tempC < CORE_TEMP_ALERT_THRESHOLD_C) {
            readings.push({ unit_name: row.food || 'Cooking', slot: 'Cooking', temp_c: tempC });
        }
    });

    (reheating || []).forEach((row) => {
        const tempC = parseFloat(row.temp);
        if (!isNaN(tempC) && tempC < CORE_TEMP_ALERT_THRESHOLD_C) {
            readings.push({ unit_name: 'Reheating', slot: 'Reheating', temp_c: tempC });
        }
    });

    return readings;
}

exports.submitAndExport = async (req, res) => {
    try {
        const employee = req.employee || req.session?.employee;
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const body = req.body || {};
        const now = new Date();
        const recordDate = now.toISOString().slice(0, 10);

        // Persist a per-employee daily draft so /api/sc3/today can actually restore it on
        // reload - previously nothing ever wrote to the store that route read from.
        const existingDraft = await checklistDrafts.getDraft('SC3', now.getFullYear(), now.getMonth() + 1, now.getDate(), employee.id);
        const draftPayload = {
            cooking: body.cooking || [],
            cooling: body.cooling || [],
            reheating: body.reheating || [],
            comments: body.comments || '',
            temp_alert_sent_at: existingDraft?.payload?.temp_alert_sent_at || null,
        };

        // Fast local pre-check only, mirroring sc2.controller.js's pattern - the portal
        // enforces the authoritative dedup with a DB unique constraint.
        const lowTempReadings = findLowCoreTempReadings(draftPayload.cooking, draftPayload.reheating);
        if (lowTempReadings.length > 0 && !draftPayload.temp_alert_sent_at) {
            await temperatureAlerts.notifyCookingTemperatureAlert({
                recordDate,
                employeeName: employee.name,
                readings: lowTempReadings,
            });
            draftPayload.temp_alert_sent_at = new Date().toISOString();
        }

        await checklistDrafts.upsertDraft({
            recordType: 'SC3',
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            day: now.getDate(),
            employeeId: employee.id,
            employeeName: employee.name,
            payload: draftPayload,
        });

        const payload = buildSc3Payload(body, employee);
        const { fileName, pdfBuffer } = await fillSc3Entry(payload);

        let syncStatus = 'disabled';
        let syncMessage = null;
        if (fileName && pdfBuffer) {
          ({ syncStatus, syncMessage } = await saveGeneratedRecord({
            fileName,
            recordType: 'SC3',
            recordDate,
            employeeId: employee.id,
            employeeName: employee.name,
            payload,
            pdfBuffer,
          }));
        }

        return res.json({
            success: true,
            fileName,
            pdfUrl: fileName ? `/records/${encodeURIComponent(fileName)}` : null,
            // Non-blocking: the record above already saved successfully. This just tells the
            // manager the record hasn't synced to SafeCater yet (e.g. inactive subscription).
            sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
