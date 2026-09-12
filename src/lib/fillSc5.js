const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { saveGeneratedRecord } = require('../services/generatedRecords');

async function fillSc5(data) {
  const pdfPath = path.join(__dirname, '../../templates/SC5_template.pdf');

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const form = pdfDoc.getForm();

  const group = form.getRadioGroup('q1');

// console.log("Options:", group.getOptions());
// console.log("Selected:", group.getSelected());

  // RADIO GROUPS
  form.getRadioGroup('q1')
    .select(data.q1 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q2')
    .select(data.q2 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q3')
    .select(data.q3 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q4')
    .select(data.q4 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q5')
    .select(data.q5 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q6')
    .select(data.q6 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q7')
    .select(data.q7 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q8')
    .select(data.q8 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q9')
    .select(data.q9 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q10')
    .select(data.q10 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q11')
    .select(data.q11 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q12')
    .select(data.q12 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q13')
    .select(data.q13 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q14')
    .select(data.q14 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q15')
    .select(data.q15 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q16')
    .select(data.q16 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q17')
    .select(data.q17 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q18')
    .select(data.q18 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q19')
    .select(data.q19 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q20')
    .select(data.q20 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q21')
    .select(data.q21 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q22')
    .select(data.q22 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q23')
    .select(data.q23 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q24')
    .select(data.q24 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q25')
    .select(data.q25 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q26')
    .select(data.q26 === 'yes' ? 'yes' : 'no');
    
  form.getRadioGroup('q27')
    .select(data.q27 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q28')
    .select(data.q28 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q29')
    .select(data.q29 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q30')
    .select(data.q30 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q31')
    .select(data.q31 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q32')
    .select(data.q32 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q33')
    .select(data.q33 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q34')
    .select(data.q34 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q35')
    .select(data.q35 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q36')
    .select(data.q36 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q37')
    .select(data.q37 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q38')
    .select(data.q38 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q39')
    .select(data.q39 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q40')
    .select(data.q40 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q41')
    .select(data.q41 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q42')
    .select(data.q42 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q43')
    .select(data.q43 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q44')
    .select(data.q44 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q45')
    .select(data.q45 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q46')
    .select(data.q46 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q47')
    .select(data.q47 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q48')
    .select(data.q48 === 'yes' ? 'yes' : 'no');

  form.getRadioGroup('q49')
    .select(data.q49 === 'yes' ? 'yes' : 'no');

  // // TEXT FIELDS
  // form.getTextField('action_notes')
  //   .setText(data.action_notes || '');

  form.getTextField('Name')
    .setText(data.name || '');

  form.getTextField('Date')
    .setText(data.date || '');

  form.getTextField('Position')
    .setText(data.position || 'Hygene Manager');

  form.getTextField('Signed')
    .setText(data.signed || '');

  form.getRadioGroup('freq_checks')
    .select(data.freq_checks || 'weekly');

  form.flatten();

  const output = await pdfDoc.save();

  // Create filename with date, employee name, and position. A trailing timestamp keeps this
  // unique per submission (defense-in-depth alongside the DB's once-daily unique index -
  // without it, two submissions on the same day by the same named employee/position would
  // collide on file_name, and file_name is the sole lookup key for download/delete-by-name).
  const sanitizedDate = (data.date || '').replace(/[/\\]/g, '-');
  const sanitizedName = (data.name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
  const sanitizedPosition = (data.position || 'Manager').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `SC5-${sanitizedDate}-${sanitizedName}-${sanitizedPosition}-${Date.now()}.pdf`;

  const { syncStatus, syncMessage, id: recordId } = await saveGeneratedRecord({
    fileName,
    recordType: 'SC5',
    // Always the server's own date in ISO form, not data.date (a client-supplied
    // DD/MM/YYYY display string used only for the filename above) - generated_records.
    // record_date is compared against ISO "today" elsewhere (listRecordTypesForDate, used by
    // /api/completed-checklists and the daily-completion check), and a DD/MM/YYYY value there
    // would never match, silently breaking "already completed today" detection.
    recordDate: new Date().toISOString().slice(0, 10),
    employeeId: data.employee_id || null,
    employeeName: data.name || 'Employee',
    payload: data,
    pdfBuffer: output,
  });

  return { fileName, syncStatus, syncMessage, recordId };
}


module.exports = fillSc5;