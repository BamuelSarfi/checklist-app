const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

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

const getSc4FilePath = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return path.join(__dirname, '../../records', `SC4-${year}-${month}.json`);
};

exports.submitForm = async (req, res) => {
  try {
    const { rows, saveMode } = req.body;
    const { employeeId, employeeName } = req.cookies;
    const employee_id = parseInt(employeeId);

    if (!employee_id || !employeeName) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const day = today.getDate();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const date = `${year}-${month}-${String(day).padStart(2, '0')}`;

    const jsonFileName = `SC4-${year}-${month}.json`;
    const jsonPath = path.join(__dirname, '../../records', jsonFileName);

    let monthData = { month, year, entries: [] };

    if (fs.existsSync(jsonPath)) {
      try {
        monthData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (err) {
        console.warn('Could not read existing SC4 file, starting fresh:', err);
      }
    }

    const newEntry = {
      employee_id,
      employee_name: employeeName,
      day,
      date,
      rows: Array.isArray(rows) ? rows : [],
      timestamp: new Date().toISOString()
    };

    const entryIndex = monthData.entries.findIndex(e => e.employee_id === employee_id && e.day === day);
    if (entryIndex >= 0) {
      monthData.entries[entryIndex] = newEntry;
    } else {
      monthData.entries.push(newEntry);
    }

    fs.writeFileSync(jsonPath, JSON.stringify(monthData, null, 2));

    res.json({ success: true, message: saveMode === 'draft' ? 'SC4 draft saved successfully' : 'SC4 form submitted successfully' });
  } catch (err) {
    console.error('Error submitting SC4 form:', err);
    res.json({ success: false, message: 'Error submitting form: ' + err.message });
  }
};

exports.exportPdf = async (req, res) => {
  try {
    const { rows } = req.body;
    const { employeeId, employeeName } = req.cookies;
    const employee_id = parseInt(employeeId);

    if (!employee_id || !employeeName) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const date = `${year}-${month}-${day}`;
    const pdfFileName = `SC4-${date}-${employeeName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    const pdfPath = path.join(__dirname, '../../records', pdfFileName);

    const pdfBytes = await fillSc4Pdf(rows, employeeName, employee_id, date);
    fs.writeFileSync(pdfPath, pdfBytes);

    const jsonFileName = `SC4-${year}-${month}.json`;
    const jsonPath = path.join(__dirname, '../../records', jsonFileName);
    if (fs.existsSync(jsonPath)) {
      try {
        const monthData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        monthData.entries = (monthData.entries || []).filter(entry => !(entry.employee_id === employee_id && entry.day === today.getDate()));
        if (monthData.entries.length > 0) {
          fs.writeFileSync(jsonPath, JSON.stringify(monthData, null, 2));
        } else {
          fs.unlinkSync(jsonPath);
        }
      } catch (err) {
        console.warn('Could not clear SC4 draft after export:', err);
      }
    }

    res.json({ success: true, pdfUrl: `/records/${pdfFileName}` });
  } catch (err) {
    console.error('Error exporting SC4 PDF:', err);
    res.json({ success: false, message: 'Error exporting PDF: ' + err.message });
  }
};

exports.getTodayData = (req, res) => {
  try {
    const { employeeId } = req.cookies;
    const employee_id = parseInt(employeeId);

    if (!employee_id) {
      return res.json({ success: false, message: 'Employee not authenticated' });
    }

    const today = new Date();
    const day = today.getDate();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const jsonPath = path.join(__dirname, '../../records', `SC4-${year}-${month}.json`);

    let data = null;
    if (fs.existsSync(jsonPath)) {
      try {
        const monthData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const entry = monthData.entries.find(e => e.employee_id === employee_id && e.day === day);
        if (entry) {
          data = { rows: entry.rows || [] };
        }
      } catch (err) {
        console.warn('Could not read SC4 data:', err);
      }
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error getting SC4 data:', err);
    res.json({ success: false, message: 'Error getting data: ' + err.message });
  }
};
