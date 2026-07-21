const fs = require('fs');
const path = require('path');
const fillSc2 = require('../lib/fillSc2');

const RECORDS_DIR = path.join(__dirname, '../../records');

function monthKeyFor(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthFileFor(date) {
    return path.join(RECORDS_DIR, `SC2-${monthKeyFor(date)}.json`);
}

function loadMonthData(date) {
    const file = monthFileFor(date);
    if (!fs.existsSync(file)) {
        return { month: monthKeyFor(date), days: {} };
    }

    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
}

function saveMonthData(date, data) {
    const file = monthFileFor(date);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
}

function getEmployee(req) {
    const employee = req.employee || req.session?.employee;
    if (!employee) return null;
    return {
        id: Number(employee.id),
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

function buildSc2PdfFields(record) {
    const fields = {};
    const dayLabel = ordinalDay(Number(record.day || new Date().getDate()));
    const temperatures = record.temperatures || {};

    for (let unit = 1; unit <= 6; unit++) {
        const suffix = unit === 1 ? '' : `_${unit}`;
        const amKey = `unit${unit}_am`;
        const pmKey = `unit${unit}_pm`;

        fields[`AM${dayLabel}${suffix}`] = temperatures[amKey] ?? '';
        fields[`PM${dayLabel}${suffix}`] = temperatures[pmKey] ?? '';
    }

    return fields;
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

exports.saveDraft = (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const dayKey = String(now.getDate());
        const monthData = loadMonthData(now);
        monthData.days ||= {};

        monthData.days[dayKey] = {
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
            comments: req.body.comments || '',
            signed: employee.name,
            status: 'draft',
            updated_at: new Date().toISOString()
        };

        saveMonthData(now, monthData);

        return res.json({
            success: true,
            message: 'Draft saved',
            record: monthData.days[dayKey]
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getTodayData = (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const dayKey = String(now.getDate());
        const monthData = loadMonthData(now);
        const record = monthData.days?.[dayKey] || null;

        return res.json({
            success: true,
            record
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getProgress = (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const monthData = loadMonthData(now);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const boxes = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const record = monthData.days?.[String(d)] || null;

            let state = 'missed';
            if (record) {
                state = record.employee_id === employee.id ? 'filled-self' : 'filled-other';
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

exports.exportPdf = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const dayKey = String(now.getDate());
        const monthData = loadMonthData(now);
        const record = monthData.days?.[dayKey];

        if (!record) {
            return res.status(404).json({ success: false, message: 'No draft found to export' });
        }

        const pdfData = {
            ...buildSc2MonthlyPdfFields(monthData, now)
        };

        const pdfPath = await fillSc2(pdfData);

        record.status = 'submitted';
        record.employee_id = employee.id;
        record.employee_name = employee.name;
        record.signed = employee.name;
        record.updated_at = new Date().toISOString();

        monthData.days[dayKey] = record;
        saveMonthData(now, monthData);

        return res.json({
            success: true,
            pdfUrl: pdfPath,
            record
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.reopenForEditing = (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid date' });
        }

        const dayKey = String(date.getDate());
        const monthData = loadMonthData(date);
        const record = monthData.days?.[dayKey];

        if (!record) {
            return res.status(404).json({ success: false, message: 'No SC2 record found to reopen' });
        }

        record.status = 'reopened';
        record.employee_id = employee.id;
        record.employee_name = employee.name;
        record.signed = employee.name;
        record.updated_at = new Date().toISOString();

        monthData.days[dayKey] = record;
        saveMonthData(date, monthData);

        return res.json({ success: true, record });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.showForm = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/sc2.html'));
};

