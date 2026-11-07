const { localDateIso } = require('../utils/kitchenTime');
const path = require('path');
const fillSc2 = require('../lib/fillSc2');
const { saveGeneratedRecord } = require('../services/generatedRecords');
const checklistDrafts = require('../services/checklistDrafts');
const temperatureAlerts = require('../services/temperatureAlerts');
const { recordAudit } = require('../services/auditLog');

// SC2 keeps one shared draft per day (not per employee - any employee on shift can fill
// it), so every checklist_drafts row for this form uses this fixed employee slot.
const SHARED_EMPLOYEE_SLOT = '';

const TEMP_ALERT_THRESHOLD_C = 8;

function hasTempAboveThreshold(temperatures) {
    // parseFloat('') / non-numeric values are NaN, and NaN > threshold is always false,
    // so empty/unfilled readings are safely ignored without an extra guard here.
    return Object.values(temperatures || {}).some((value) => parseFloat(value) > TEMP_ALERT_THRESHOLD_C);
}

async function loadMonthData(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const rows = await checklistDrafts.listMonthEntries('SC2', year, month);

    const days = {};
    for (const row of rows) {
        days[String(row.day)] = row.payload;
    }

    return { month: `${year}-${String(month).padStart(2, '0')}`, days };
}

async function saveDayRecord(date, dayRecord) {
    await checklistDrafts.upsertDraft({
        recordType: 'SC2',
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        employeeId: SHARED_EMPLOYEE_SLOT,
        employeeName: dayRecord.employee_name || null,
        payload: dayRecord,
        status: dayRecord.status || 'draft',
    });
}

const MAX_UNITS = 6;
const MAX_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 2000;

function cleanText(value, maxLength) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, maxLength) : '';
}

// The shared day log is read by every employee, so what one person saves is checked here rather than
// trusted. An unchecked unit_count froze the page for the next person, who'd loop up to whatever
// number was sent.
function cleanDayInput(body = {}) {
    const unitCount = Math.min(Math.max(parseInt(body.unit_count, 10) || 1, 1), MAX_UNITS);
    const unitNames = {};
    const temperatures = {};
    const correctiveActions = {};

    for (let unit = 1; unit <= MAX_UNITS; unit++) {
        const name = cleanText(body.unit_names?.[unit], MAX_NAME_LENGTH);
        if (name) unitNames[unit] = name;

        for (const slot of ['am', 'pm']) {
            const key = `unit${unit}_${slot}`;
            const reading = body.temperatures?.[key];
            if (reading !== undefined) {
                const parsed = parseFloat(reading);
                temperatures[key] = Number.isFinite(parsed) ? parsed : null;
            }

            const fieldKey = `temp_${key}`;
            const action = body.corrective_actions?.[fieldKey];
            if (action && typeof action === 'object') {
                correctiveActions[fieldKey] = { ...action, note: cleanText(action.note, MAX_NOTE_LENGTH) };
            }
        }
    }

    return {
        unit_count: unitCount,
        unit_names: unitNames,
        temperatures,
        corrective_actions: correctiveActions,
        comments: cleanText(body.comments, MAX_NOTE_LENGTH),
    };
}

// The day's log is shared and signed by whoever saves last, so keep who it was signed by before.
async function auditResign(previous, employee, date) {
    if (!previous?.employee_id || String(previous.employee_id) === String(employee.id)) {
        return;
    }

    await recordAudit({
        action: 'sc2_day_resigned',
        recordType: 'SC2',
        recordDate: date,
        actor: employee,
        details: { previous_employee_id: previous.employee_id, previous_signed: previous.signed || null },
    });
}

function getEmployee(req) {
    const employee = req.employee || req.session?.employee;
    if (!employee) return null;
    return {
        id: employee.id,
        name: employee.name || employee.full_name || ''
    };
}

function ordinalDay(day) {
    const rem100 = day % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
}

function monthName(monthNumber) {
    return [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ][monthNumber - 1] || String(monthNumber);
}

function buildSc2MonthlyPdfFields(monthData, dateInMonth) {
    const year = dateInMonth.getFullYear();
    const month = dateInMonth.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    const fields = {
        Month: monthName(month),   // template field: Month
        Year: String(year)         // template field: Year
    };

    for (let d = 1; d <= daysInMonth; d++) {
        const dayLabel = ordinalDay(d); // 1st, 2nd, 3rd...
        const record = monthData.days?.[String(d)] || null;
        const temperatures = record?.temperatures || {};

        // AM/PM fields for up to 6 units:
        // AM1st, PM1st, AM1st_2, PM1st_2 ... AM1st_6, PM1st_6
        for (let unit = 1; unit <= 6; unit++) {
            const suffix = unit === 1 ? '' : `_${unit}`;
            fields[`AM${dayLabel}${suffix}`] = temperatures[`unit${unit}_am`] ?? '';
            fields[`PM${dayLabel}${suffix}`] = temperatures[`unit${unit}_pm`] ?? '';
        }

        // comments field names: 1st, 2nd, 3rd ... 31st
        fields[dayLabel] = record?.comments || '';

        // signed field names: sign1, sign2 ... sign31
        fields[`sign${d}`] = record?.signed || '';
    }

    return fields;
}

exports.saveDraft = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const dayKey = String(now.getDate());
        const monthData = await loadMonthData(now);

        const dayRecord = {
            ...(monthData.days[dayKey] || {}),
            employee_id: employee.id,
            employee_name: employee.name,
            date: localDateIso(now),
            day: now.getDate(),
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            ...cleanDayInput(req.body),
            signed: employee.name,
            status: 'draft',
            updated_at: new Date().toISOString()
        };

        // Fast local pre-check only - not the source of truth for dedup (the portal enforces
        // that with a DB unique constraint, see temperatureAlerts.js). This just avoids an
        // outbound call on every autosave once a kitchen has already been alerted today.
        // Notify is awaited but never throws, and the dedup flag is set unconditionally after
        // it returns (even on failure) so a down portal can't cause a retry storm.
        if (hasTempAboveThreshold(dayRecord.temperatures) && !monthData.days[dayKey]?.temp_alert_sent_at) {
            await temperatureAlerts.notifyTemperatureAlert({
                recordDate: dayRecord.date,
                employeeName: dayRecord.employee_name,
                unitNames: dayRecord.unit_names,
                temperatures: dayRecord.temperatures,
            });
            dayRecord.temp_alert_sent_at = new Date().toISOString();
        }

        await auditResign(monthData.days[dayKey], employee, dayRecord.date);
        await saveDayRecord(now, dayRecord);

        return res.json({
            success: true,
            message: 'Draft saved',
            record: dayRecord
        });
    } catch (err) {
        console.error('[sc2]', err);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

exports.getTodayData = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const draft = await checklistDrafts.getDraft('SC2', now.getFullYear(), now.getMonth() + 1, now.getDate(), SHARED_EMPLOYEE_SLOT);

        return res.json({
            success: true,
            record: draft?.payload || null
        });
    } catch (err) {
        console.error('[sc2]', err);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

exports.getProgress = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const monthData = await loadMonthData(now);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const boxes = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const record = monthData.days?.[String(d)] || null;

            let state = 'missed';
            if (record) {
                state = String(record.employee_id) === String(employee.id) ? 'filled-self' : 'filled-other';
            }

            boxes.push({
                day: d,
                state,
                employee_name: record?.employee_name || ''
            });
        }

        return res.json({
            success: true,
            daysInMonth,
            boxes
        });
    } catch (err) {
        console.error('[sc2]', err);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

exports.getDay = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = parseInt(req.query.day, 10);
        const daysInMonth = new Date(year, month, 0).getDate();

        if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
            return res.status(400).json({ success: false, message: 'Invalid day' });
        }

        const draft = await checklistDrafts.getDraft('SC2', year, month, day, SHARED_EMPLOYEE_SLOT);

        return res.json({
            success: true,
            record: draft?.payload || null
        });
    } catch (err) {
        console.error('[sc2]', err);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

exports.exportPdf = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const dayKey = String(now.getDate());
        const monthData = await loadMonthData(now);
        const record = monthData.days?.[dayKey];

        if (!record) {
            return res.status(404).json({ success: false, message: 'No draft found to export' });
        }

        const pdfData = {
            ...buildSc2MonthlyPdfFields(monthData, now)
        };

        const generated = await fillSc2(pdfData);

        let syncStatus = 'disabled';
        let syncMessage = null;
        if (generated) {
            ({ syncStatus, syncMessage } = await saveGeneratedRecord({
                fileName: generated.fileName,
                recordType: 'SC2',
                recordDate: localDateIso(now),
                employeeId: employee.id,
                employeeName: employee.name,
                payload: pdfData,
                pdfBuffer: generated.pdfBuffer,
            }));
        }

        await auditResign(record, employee, localDateIso(now));

        record.status = 'submitted';
        record.employee_id = employee.id;
        record.employee_name = employee.name;
        record.signed = employee.name;
        record.updated_at = new Date().toISOString();

        await saveDayRecord(now, record);

        return res.json({
            success: true,
            pdfUrl: generated ? `/records/${encodeURIComponent(generated.fileName)}` : null,
            record,
            // Non-blocking: the record above already saved successfully. This just tells the
            // manager the record hasn't synced to SafeCater yet (e.g. inactive subscription).
            sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
        });
    } catch (err) {
        console.error('[sc2]', err);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

exports.showForm = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/sc2.html'));
};
