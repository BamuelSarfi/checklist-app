const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// Helper function to convert day number to ordinal string
function getDayOrdinal(day) {
  const dayNum = parseInt(day);
  if (dayNum > 3 && dayNum < 21) return dayNum + 'th';
  switch (dayNum % 10) {
    case 1: return dayNum + 'st';
    case 2: return dayNum + 'nd';
    case 3: return dayNum + 'rd';
    default: return dayNum + 'th';
  }
}

// ...existing code...

async function fillSc2(data) {
  try {
    const pdfPath = path.join(__dirname, '../../templates/SC2_template_7.pdf');
    
     if (!fs.existsSync(pdfPath)) {
      console.log('Note: SC2_template_7.pdf not found. Skipping PDF generation.');
      return null;
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    // Build a quick lookup of actual field names in the template
    const fieldNames = new Set(form.getFields().map((f) => f.getName()));

    const setTextIfExists = (fieldName, value) => {
      if (!fieldName || value === null || value === undefined) return false;
      if (!fieldNames.has(fieldName)) return false;
      try {
        form.getTextField(fieldName).setText(String(value));
        return true;
      } catch {
        return false;
      }
    };

    const setByCandidates = (candidates, value) => {
      for (const name of candidates) {
        if (setTextIfExists(name, value)) return true;
      }
      return false;
    };

    // Accept both { month, year } and { Month, Year }
    const monthRaw = data.month ?? data.Month;
    const yearRaw = data.year ?? data.Year;

    const monthNumber =
      typeof monthRaw === 'number'
        ? monthRaw
        : Number.parseInt(String(monthRaw || ''), 10);

    const yearValue = yearRaw ? String(yearRaw) : String(new Date().getFullYear());

    // Fill month/year if available
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

    const monthName =
      Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12
        ? monthNames[monthNumber - 1]
        : (typeof monthRaw === 'string' ? monthRaw : '');

    try {
      const monthField = form.getTextField('Month');
      if (monthField && monthName) monthField.setText(monthName);
    } catch (e) {}

    try {
      const yearField = form.getTextField('Year');
      if (yearField) yearField.setText(yearValue);
    } catch (e) {}

    // Fill unit names into header columns (up to 7 units)
    // Supports data.unit_names object keys like "1".."7" (or numeric keys)
    const unitNames = data.unit_names || {};
    for (let i = 1; i <= 7; i++) {
      const unitValue = unitNames[i] ?? unitNames[String(i)] ?? '';
      if (!unitValue) continue;

      const candidates = [
        `unit${i}`, `Unit ${i}`, `unit${i}`, `unit_${i}`, `UNIT${i}`,
        `Fridge${i}`, `Fridge ${i}`, `fridge${i}`,
        `ColdRoom${i}`, `Cold Room ${i}`, `coldroom${i}`,
        `Cabinet${i}`, `Cabinet ${i}`
      ];

      // Some templates name first column without index
      if (i === 1) {
        candidates.unshift('Unit', 'unit', 'Fridge', 'fridge', 'Cold Room', 'ColdRoom');
      }

      const matched = setByCandidates(candidates, unitValue);
      if (!matched) {
        console.warn(`SC2 unit name not mapped for unit ${i}: "${unitValue}"`);
      }
    }

    // Fill direct flat fields too (AM1st, PM1st_2, 1st, sign1, etc.)
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'object') return;
      setTextIfExists(key, value);
    });
      
    const safeMonth = String(
      Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12
        ? monthNumber
        : new Date().getMonth() + 1
    ).padStart(2, '0');

    const sanitizedName = (data.employee_name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `SC2-${yearValue}-${safeMonth}-${sanitizedName}.pdf`;
      const outPath = path.join(__dirname, '../../records', fileName);

    
    form.flatten();
    const output = await pdfDoc.save();
    fs.writeFileSync(outPath, output);
    return fileName;
  } catch (err) {
    console.error('Error generating SC2 PDF:', err);
    return null;
  }
}


module.exports = fillSc2;

