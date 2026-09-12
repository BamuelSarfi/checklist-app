const path = require('path');
const fillSc2 = require('../lib/fillSc2');
const { saveGeneratedRecord } = require('../services/generatedRecords');
const checklistDrafts = require('../services/checklistDrafts');
const temperatureAlerts = require('../services/temperatureAlerts');

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
            date: now.toISOString().slice(0, 10),
            day: now.getDate(),
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            unit_count: req.body.unit_count || 1,
            unit_names: req.body.unit_names || {},
            temperatures: req.body.temperatures || {},
            corrective_actions: req.body.corrective_actions || {},
            comments: req.body.comments || '',
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

        await saveDayRecord(now, dayRecord);

        return res.json({
            success: true,
            message: 'Draft saved',
            record: dayRecord
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
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
        return res.status(500).json({ success: false, message: err.message });
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
        return res.status(500).json({ success: false, message: err.message });
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
        return res.status(500).json({ success: false, message: err.message });
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
                recordDate: now.toISOString().slice(0, 10),
                employeeId: employee.id,
                employeeName: employee.name,
                payload: pdfData,
                pdfBuffer: generated.pdfBuffer,
            }));
        }

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
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.reopenForEditing = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
        // new Date("YYYY-MM-DD") parses as UTC midnight, but getDraft/saveDayRecord below
        // read it back with local getters (getFullYear/getMonth/getDate) - in any timezone
        // west of UTC that round-trip lands on the previous day. Building the Date directly
        // from the local Y/M/D components avoids the UTC parse entirely.
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, (month || 1) - 1, day);
        if (Number.isNaN(date.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid date' });
        }

        const draft = await checklistDrafts.getDraft('SC2', date.getFullYear(), date.getMonth() + 1, date.getDate(), SHARED_EMPLOYEE_SLOT);
        const record = draft?.payload;

        if (!record) {
            return res.status(404).json({ success: false, message: 'No SC2 record found to reopen' });
        }

        record.status = 'reopened';
        record.employee_id = employee.id;
        record.employee_name = employee.name;
        record.signed = employee.name;
        record.updated_at = new Date().toISOString();

        await saveDayRecord(date, record);

        return res.json({ success: true, record });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.showForm = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/sc2.html'));
};
