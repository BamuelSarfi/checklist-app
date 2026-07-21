const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

async function fillSc1(data) {
  const pdfPath = path.join(__dirname, '../../templates/SC1_template.pdf');

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const form = pdfDoc.getForm();

  // Debug: Log all available fields
  // const fields = form.getFields();
  // console.log('Available PDF fields:');
  // fields.forEach(field => {
  //   console.log(`- ${field.getName()}`);
  // });

  // Fill header information
//   if (form.getTextField('employee_name')) {
//     form.getTextField('employee_name').setText(data.employee_name || '');
//   }

  if (form.getTextField('Date1')) {
    form.getTextField('Date1').setText(data.records[0]?.date || '');
  }

  // Fill record data (up to 16 records)
  for (let i = 0; i < Math.min(data.records.length, 16); i++) {
    const record = data.records[i];
    const recordNum = i + 1;

    // Date field - try different variations
    let dateField;
    try {
      dateField = form.getTextField(`Date${recordNum}`);
    } catch (e) {
      try {
        dateField = form.getTextField(`date${recordNum}`);
      } catch (e2) {
        // no field
      }
    }
    if (dateField) {
      dateField.setText(record.date || '');
    }

    // Food Item field
    let foodItemField;
    try {
      foodItemField = form.getTextField(`food_item${recordNum}`);
    } catch (e) {
      // no field
    }
    if (foodItemField) {
      foodItemField.setText(record.food_item || '');
    }

    // Supplied By field
    let suppliedByField;
    try {
      suppliedByField = form.getTextField(`supplied_by${recordNum}`);
    } catch (e) {
      // no field
    }
    if (suppliedByField) {
      suppliedByField.setText(record.supplied_by || '');
    }

    // Checked Use By checkbox - try different variations
    let checkedField;
    try {
      checkedField = form.getCheckBox(`checked_use_by${recordNum}`);
    } catch (e) {
      try {
        checkedField = form.getCheckBox(`checked_use_by_date${recordNum}`);
      } catch (e2) {
        // no field
      }
    }
    if (checkedField) {
      if (record.checked_use_by) {
        checkedField.check();
      } else {
        checkedField.uncheck();
      }
    }

    // Temperature field
    let tempField;
    try {
      tempField = form.getTextField(`temp${recordNum}`);
    } catch (e) {
      // no field
    }
    if (tempField) {
      tempField.setText(record.temp || '');
    }

    // Sign field
    let signField;
    try {
      signField = form.getTextField(`sign${recordNum}`);
    } catch (e) {
      // no field
    }
    if (signField) {
      signField.setText(record.sign || '');
    }
  }

  form.flatten();

  const output = await pdfDoc.save();

  // Create filename with date and employee name
  const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '-'); //DD-MM-YYYY format
  const sanitizedName = (data.employee_name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `SC1-${today}-${sanitizedName}.pdf`;
  const outPath = path.join(__dirname, '../../records', fileName);

  fs.writeFileSync(outPath, output);

  return fileName;
}

module.exports = fillSc1;