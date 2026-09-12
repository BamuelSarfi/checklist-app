const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { getEmployeeById } = require('../services/employeeDirectory');
const { saveGeneratedRecord } = require('../services/generatedRecords');
const checklistDrafts = require('../services/checklistDrafts');

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

const fillSc4Pdf = async (rows, employeeName, employeeId, date) => {
  const templatePath = path.join(__dirname, '../../templates/SC4_template.pdf');
  if (!fs.existsSync(templatePath)) {
    throw new Error('SC4 template not found');
  }

  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const safeEmployeeName = employeeName || 'Employee';
  const safeDate = date || '';

  try {
    const employeeField = form.getTextField('employee_name');
    if (employeeField) employeeField.setText(safeEmployeeName);
  } catch (err) {}

  try {
    const dateField = form.getTextField('date');
    if (dateField) dateField.setText(safeDate);
  } catch (err) {}

  const entries = Array.isArray(rows) ? rows : [];
  entries.forEach((row, index) => {
    const rowNumber = index + 1;
    const fields = {
      date: `date_${rowNumber}`,
      food: `food_${rowNumber}`,
      time_into_hot_hold: `time_into_hot_hold_${rowNumber}`,
      core_temp_2hrs: `core_temp_2hrs_${rowNumber}`,
      core_temp_4hrs: `core_temp_4hrs_${rowNumber}`,
      core_temp_6hrs: `core_temp_6hrs_${rowNumber}`,
      comment: `comment_${rowNumber}`,
      signed: `signed_${rowNumber}`
    };

    Object.entries(fields).forEach(([sourceKey, fieldName]) => {
      const value = row[sourceKey] || '';
      if (!fieldName) return;
      try {
        const field = form.getTextField(fieldName);
        if (field) field.setText(String(value));
      } catch (err) {}
    });
  });

  form.flatten();
  return await pdfDoc.save();
};

exports.submitForm = async (req, res) => {
  try {
    const { rows, saveMode } = req.body;
    const employee = await resolveEmployee(req);

    if (!employee) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const newEntry = {
      employee_id: employee.id,
      employee_name: employee.name,
      day,
      date,
      rows: Array.isArray(rows) ? rows : [],
      timestamp: new Date().toISOString()
    };

    await checklistDrafts.upsertDraft({
      recordType: 'SC4',
      year,
      month,
      day,
      employeeId: employee.id,
      employeeName: employee.name,
      payload: newEntry,
    });

    res.json({ success: true, message: saveMode === 'draft' ? 'SC4 draft saved successfully' : 'SC4 form submitted successfully' });
  } catch (err) {
    console.error('Error submitting SC4 form:', err);
    res.json({ success: false, message: 'Error submitting form: ' + err.message });
  }
};

exports.exportPdf = async (req, res) => {
  try {
    const { rows } = req.body;
    const employee = await resolveEmployee(req);

    if (!employee) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Trailing timestamp keeps this unique per submission - without it, two exports the same
    // day for the same employee collide on file_name (no UNIQUE constraint), and a delete
    // only removes the newest row, orphaning the other's R2 object.
    const pdfFileName = `SC4-${date}-${String(employee.name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.pdf`;

    const pdfBytes = await fillSc4Pdf(rows, employee.name, employee.id, date);

    const { syncStatus, syncMessage } = await saveGeneratedRecord({
      fileName: pdfFileName,
      recordType: 'SC4',
      recordDate: date,
      employeeId: employee.id,
      employeeName: employee.name,
      payload: { rows },
      pdfBuffer: pdfBytes,
    });

    await checklistDrafts.deleteDraft('SC4', year, month, day, employee.id);

    res.json({
      success: true,
      pdfUrl: `/records/${encodeURIComponent(pdfFileName)}`,
      // Non-blocking: the record above already saved successfully. This just tells the
      // manager the record hasn't synced to SafeCater yet (e.g. inactive subscription).
      sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
    });
  } catch (err) {
    console.error('Error exporting SC4 PDF:', err);
    res.json({ success: false, message: 'Error exporting PDF: ' + err.message });
  }
};

exports.getTodayData = async (req, res) => {
  try {
    const employee = await resolveEmployee(req);

    if (!employee) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const draft = await checklistDrafts.getDraft('SC4', today.getFullYear(), today.getMonth() + 1, today.getDate(), employee.id);

    res.json({ success: true, data: draft ? { rows: draft.payload?.rows || [] } : null });
  } catch (err) {
    console.error('Error getting SC4 data:', err);
    res.json({ success: false, message: 'Error getting data: ' + err.message });
  }
};
