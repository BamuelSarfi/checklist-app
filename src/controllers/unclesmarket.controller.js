const path = require('path');
const fillUnclesMarket = require('../lib/fillUnclesMarket');
const { saveGeneratedRecord } = require('../services/generatedRecords');
const checklistDrafts = require('../services/checklistDrafts');
const { SECTION_OPTIONS, TASKS } = require('../lib/unclesMarketSections');

// Uncle's Market is a business-specific bolt-on (see ENABLE_UNCLES_MARKET in server.js) -
// 9 physical sections, each independently draft/export-able on the same day, reusing
// checklistDrafts.js's generic (kitchen_id, record_type, year, month, day, employee_id)
// schema by giving every section its own record_type rather than adding a schema column.
// Like SC2, each section's daily record is shared (any employee on shift can fill it), not
// per-employee, so employeeId is always the same fixed slot.
const SHARED_EMPLOYEE_SLOT = '';

function recordTypeForSection(sectionId) {
    return `UM_${sectionId.toUpperCase()}`;
}

function sectionTitleForId(sectionId) {
    return SECTION_OPTIONS.find((section) => section.id === sectionId)?.title || "Uncle's Market";
}

function resolveSectionId(req) {
    const sectionId = req.body?.section_id || req.body?.section || req.query?.section_id || req.query?.section;
    return SECTION_OPTIONS.some((section) => section.id === sectionId) ? sectionId : SECTION_OPTIONS[0].id;
}

function normalizeTasks(tasks) {
    const sourceTasks = Array.isArray(tasks) ? tasks : [];
    return TASKS.map((label, index) => {
        const source = sourceTasks[index] || {};
        return {
            label,
            cleaned: !!source.cleaned,
            time: source.time || '',
        };
    });
}

function getEmployee(req) {
    const employee = req.employee || req.session?.employee;
    if (!employee) return null;
    return {
        id: employee.id,
        name: employee.name || employee.full_name || '',
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

async function loadSectionMonthData(sectionId, date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const rows = await checklistDrafts.listMonthEntries(recordTypeForSection(sectionId), year, month);

    const days = {};
    for (const row of rows) {
        days[String(row.day)] = row.payload;
    }

    return { month: `${year}-${String(month).padStart(2, '0')}`, days };
}

async function saveSectionDayRecord(sectionId, date, dayRecord) {
    await checklistDrafts.upsertDraft({
        recordType: recordTypeForSection(sectionId),
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        employeeId: SHARED_EMPLOYEE_SLOT,
        employeeName: dayRecord.employee_name || null,
        payload: dayRecord,
        status: dayRecord.status || 'draft',
    });
}

function buildRecord(date, employee, body, existingRecord, sectionId) {
    const day = date.getDate();
    const tasks = normalizeTasks(body?.tasks);

    return {
        ...(existingRecord || {}),
        employee_id: employee.id,
        employee_name: employee.name,
        date: date.toISOString().slice(0, 10),
        day,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
        section_id: sectionId,
        section_name: sectionTitleForId(sectionId),
        tasks,
        comment: body?.comment || '',
        signed: employee.name,
        status: 'draft',
        updated_at: new Date().toISOString(),
    };
}

function buildMonthlyPdfFields(sectionData, dateInMonth) {
    const year = dateInMonth.getFullYear();
    const month = dateInMonth.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const fields = {
        Month: String(month),
        Year: String(year),
    };

    for (let d = 1; d <= daysInMonth; d++) {
        const record = sectionData?.days?.[String(d)] || null;
        const dayLabel = ordinalDay(d);
        const tasks = Array.isArray(record?.tasks) ? record.tasks : [];

        for (let index = 0; index < TASKS.length; index++) {
            const suffix = index === 0 ? '' : `_${index + 1}`;
            fields[`Time${dayLabel}${suffix}`] = tasks[index]?.time || '';
        }

        fields[`Comments${dayLabel}`] = record?.comment || '';
        fields[`Signed${dayLabel}`] = record?.signed || '';
    }

    return fields;
}

exports.showForm = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/unclesmarket_checklist.html'));
};

exports.showSelection = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/unclesmarket_selection.html'));
};

exports.getSectionOptions = (req, res) => {
    res.json({ success: true, section_options: SECTION_OPTIONS });
};

exports.getTodayData = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const sectionId = resolveSectionId(req);
        const now = new Date();
        const draft = await checklistDrafts.getDraft(recordTypeForSection(sectionId), now.getFullYear(), now.getMonth() + 1, now.getDate(), SHARED_EMPLOYEE_SLOT);

        return res.json({
            success: true,
            record: draft?.payload || null,
            selected_section_id: sectionId,
            selected_section_name: sectionTitleForId(sectionId),
            section_options: SECTION_OPTIONS,
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

        const sectionId = resolveSectionId(req);
        const now = new Date();
        const monthData = await loadSectionMonthData(sectionId, now);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const boxes = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const record = monthData.days?.[String(d)] || null;
            let state = 'missed';
            if (record) {
                state = String(record.employee_id) === String(employee.id) ? 'filled-self' : 'filled-other';
            }

            boxes.push({ day: d, state, employee_name: record?.employee_name || '' });
        }

        return res.json({ success: true, section_id: sectionId, daysInMonth, boxes });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Overview across all 9 sections, used by the section-selection page: a per-section "done
// today" badge, plus a month grid where each day is 'missed' (0 sections done), 'partial'
// (1-8 done) or 'complete' (all 9).
exports.getOverview = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const todayKey = String(now.getDate());
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const monthDataBySection = {};
        for (const section of SECTION_OPTIONS) {
            // eslint-disable-next-line no-await-in-loop
            monthDataBySection[section.id] = await loadSectionMonthData(section.id, now);
        }

        const sections = SECTION_OPTIONS.map((section) => {
            const record = monthDataBySection[section.id].days?.[todayKey] || null;
            return {
                id: section.id,
                title: section.title,
                done_today: !!record,
                employee_name: record?.employee_name || '',
            };
        });

        const boxes = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dayKey = String(d);
            const doneCount = SECTION_OPTIONS.reduce((count, section) => (
                count + (monthDataBySection[section.id].days?.[dayKey] ? 1 : 0)
            ), 0);

            let state = 'missed';
            if (doneCount >= SECTION_OPTIONS.length) state = 'complete';
            else if (doneCount > 0) state = 'partial';

            boxes.push({ day: d, state, done_count: doneCount, total: SECTION_OPTIONS.length });
        }

        return res.json({ success: true, daysInMonth, sections, boxes });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.saveDraft = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const sectionId = resolveSectionId(req);
        const now = new Date();
        const monthData = await loadSectionMonthData(sectionId, now);
        const dayKey = String(now.getDate());
        const existingRecord = monthData.days[dayKey] || null;

        const nextRecord = buildRecord(now, employee, req.body || {}, existingRecord, sectionId);
        await saveSectionDayRecord(sectionId, now, nextRecord);

        return res.json({ success: true, message: 'Draft saved', record: nextRecord });
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

        const sectionId = resolveSectionId(req);
        const now = new Date();
        const monthData = await loadSectionMonthData(sectionId, now);
        const dayKey = String(now.getDate());
        const record = monthData.days?.[dayKey];

        if (!record) {
            return res.status(404).json({ success: false, message: 'No draft found to export' });
        }

        const pdfData = buildMonthlyPdfFields(monthData, now);
        const generated = await fillUnclesMarket(pdfData, { date: now, section_id: sectionId, employee_name: employee.name });

        let syncStatus = 'disabled';
        let syncMessage = null;
        if (generated) {
            ({ syncStatus, syncMessage } = await saveGeneratedRecord({
                fileName: generated.fileName,
                recordType: recordTypeForSection(sectionId),
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

        await saveSectionDayRecord(sectionId, now, record);

        return res.json({
            success: true,
            pdfUrl: generated ? `/records/${encodeURIComponent(generated.fileName)}` : null,
            record,
            sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Runs every section's monthly PDF to the library, not just the ones an employee actually
// filled in - a section with no records that month is still audit-relevant (it shows the
// gap), so it gets its own mostly-blank PDF rather than being silently skipped. Called from
// the internal cron sweep (see internalCronRoutes-style wiring in server.js), not a raw
// setInterval like the old standalone app used.
exports.autoExportPreviousMonth = async () => {
    const now = new Date();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const exportedFiles = [];

    for (const section of SECTION_OPTIONS) {
        // eslint-disable-next-line no-await-in-loop
        const sectionData = await loadSectionMonthData(section.id, previousMonthDate);
        const lastRecord = Object.values(sectionData.days || {})
            .filter(Boolean)
            .sort((left, right) => Number(left.day || 0) - Number(right.day || 0))
            .at(-1) || null;

        const pdfData = buildMonthlyPdfFields(sectionData, previousMonthDate);
        // eslint-disable-next-line no-await-in-loop
        const generated = await fillUnclesMarket(pdfData, {
            date: previousMonthDate,
            section_id: section.id,
            employee_name: lastRecord?.employee_name || 'Employee',
        });

        if (generated) {
            // eslint-disable-next-line no-await-in-loop
            await saveGeneratedRecord({
                fileName: generated.fileName,
                recordType: recordTypeForSection(section.id),
                recordDate: previousMonthDate.toISOString().slice(0, 10),
                employeeId: lastRecord?.employee_id || null,
                employeeName: lastRecord?.employee_name || 'Employee',
                payload: pdfData,
                pdfBuffer: generated.pdfBuffer,
            });
            exportedFiles.push(generated.fileName);
        }
    }

    return exportedFiles;
};
