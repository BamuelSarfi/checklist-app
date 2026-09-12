const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { saveGeneratedRecord } = require('../services/generatedRecords');

// Real AcroField names verified directly against SC7_template.pdf via pdf-lib - note the
// space (not underscore) in the two employee-detail fields and the genuine typo in
// PreEmploymentAssesment (missing an "s"), both load-bearing since a mismatched name is a
// silent no-op with pdf-lib (setText/select just throw "field not found", caught below).
const REASON_CHECKBOX_FIELDS = {
  existing_food_handler: 'ExistingFoodHandler',
  pre_employment: 'PreEmploymentAssesment',
  return_to_work: 'ReturnToWorkAfterIllness',
};

// Question1-Question7 map top-to-bottom on the page to: Q1 main (diarrhoea/vomiting), Q1
// sub-question (medication), Q2 i/ii/iii (wound, boils, discharge), Q3 (typhoid carrier),
// Q4 (contact with typhoid case) - resolved from each PDFRadioGroup's widget Y-position.
const QUESTION_FIELDS = ['Question1', 'Question2', 'Question3', 'Question4', 'Question5', 'Question6', 'Question7'];

async function fillSc7(data) {
  const pdfPath = path.join(__dirname, '../../templates/SC7_template.pdf');
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();

  const setText = (fieldName, value) => {
    try {
      form.getTextField(fieldName).setText(value || '');
    } catch (_err) { /* field missing - skip rather than fail the whole submission */ }
  };

  const setRadio = (fieldName, isYes) => {
    try {
      form.getRadioGroup(fieldName).select(isYes ? 'Yes' : 'No');
    } catch (_err) { /* field missing - skip */ }
  };

  const setCheckbox = (fieldName, checked) => {
    try {
      const box = form.getCheckBox(fieldName);
      if (checked) box.check(); else box.uncheck();
    } catch (_err) { /* field missing - skip */ }
  };

  setText('NAME OFEMPLOYEE', data.name || '');
  setText('DATE OF ASSESSMENT', data.date || '');

  const reasonField = REASON_CHECKBOX_FIELDS[data.reason];
  Object.values(REASON_CHECKBOX_FIELDS).forEach((fieldName) => {
    setCheckbox(fieldName, fieldName === reasonField);
  });

  QUESTION_FIELDS.forEach((fieldName, index) => {
    setRadio(fieldName, data[`q${index + 1}`] === 'yes');
  });

  setText('Action_taken', data.action_taken || '');

  // Employee self-completes and signs at the kiosk; the owner/manager fields (OWNERMANAGER,
  // DATE) are intentionally left blank here - there's no manager present at submission time,
  // they review the synced record on the portal dashboard instead.
  setText('EMPLOYEE', data.name || '');
  setText('DATE_2', data.date || '');

  form.flatten();

  const output = await pdfDoc.save();

  const sanitizedDate = (data.date || '').replace(/[/\\]/g, '-');
  const sanitizedName = (data.name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `SC7-${sanitizedDate}-${sanitizedName}-${Date.now()}.pdf`;

  const { syncStatus, syncMessage, id: recordId } = await saveGeneratedRecord({
    fileName,
    recordType: 'SC7',
    recordDate: new Date().toISOString().slice(0, 10),
    employeeId: data.employee_id || null,
    employeeName: data.name || 'Employee',
    payload: data,
    pdfBuffer: output,
  });

  return { fileName, syncStatus, syncMessage, recordId };
}

module.exports = fillSc7;
