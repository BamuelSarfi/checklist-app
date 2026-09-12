const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { SECTION_PDF_STATE } = require('./unclesMarketSections');

function monthKeyFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Uncle's Market is a business-specific bolt-on (only enabled for this one kitchen via
// ENABLE_UNCLES_MARKET) - one PDF per section per month, matching fillSc2.js's shape
// (return { fileName, pdfBuffer } for generatedRecords.saveGeneratedRecord to upload,
// rather than writing to records/ directly like the old standalone app did).
async function fillUnclesMarket(data, options = {}) {
  try {
    const date = options.date instanceof Date ? options.date : new Date();
    const templatePath = path.join(__dirname, '../../templates/unclesmarket_checklist.pdf');

    if (!fs.existsSync(templatePath)) {
      console.log('Note: unclesmarket_checklist.pdf not found. Skipping PDF generation.');
      return null;
    }

    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fieldNames = new Set(form.getFields().map((field) => field.getName()));

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

    const monthLabel = (() => {
      const monthRaw = data.Month ?? data.month;
      const monthNumber = typeof monthRaw === 'number' ? monthRaw : Number.parseInt(String(monthRaw || ''), 10);
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      if (Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        return monthNames[monthNumber - 1];
      }
      if (typeof monthRaw === 'string' && monthRaw.trim()) {
        return monthRaw;
      }
      return monthNames[date.getMonth()];
    })();

    setTextIfExists('Month', monthLabel);
    setTextIfExists('Year', String(data.Year ?? data.year ?? date.getFullYear()));

    // `cleaning_area` is a radio-button group on the template, not a text field - must be
    // selected via the RadioGroup API.
    const pdfState = SECTION_PDF_STATE[options.section_id];
    if (pdfState) {
      try {
        form.getRadioGroup('cleaning_area').select(pdfState);
      } catch {
        // Unknown state on this template revision; leave unset.
      }
    }

    Object.entries(data || {}).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'object') return;
      setTextIfExists(key, value);
    });

    const sectionId = options.section_id || 'section';
    // Trailing timestamp keeps this unique per export (same rationale as fillSc2.js) -
    // without it, exporting the same section+month twice collides on file_name.
    const fileName = `UM-${monthKeyFor(date)}-${sectionId}-${Date.now()}.pdf`;

    form.flatten();
    const output = await pdfDoc.save();
    return { fileName, pdfBuffer: output };
  } catch (err) {
    console.error("Error generating Uncle's Market PDF:", err);
    return null;
  }
}

module.exports = fillUnclesMarket;
