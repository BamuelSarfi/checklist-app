const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function normalizeRows(data = {}) {
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.entries)) return data.entries;

  const rows = [];
  for (let i = 1; i <= 17; i++) {
    rows.push({
      date: data[`date_${i}`],
      food: data[`food_${i}`],
      time_started_cooking: data[`time_started_cooking_${i}`],
      time_finished_cooking: data[`time_finished_cooking_${i}`],
      core_temp: data[`core_temp_${i}`],
      cooking_sign: data[`cooking_sign_${i}`],
      cooling_date: data[`cooling_date_${i}`],
      time_into_fridge: data[`time_into_fridge_${i}`],
      cooling_sign: data[`cooling_sign_${i}`],
      reheating_date: data[`reheating_date_${i}`],
      reheating_core_temp: data[`reheating_core_temp_${i}`],
      reheating_sign: data[`reheating_sign_${i}`],
      comment: data[`comment_${i}`]
    });
  }
  return rows;
}

module.exports = async function fillSc3Entry(data = {}) {
  const templatePath = path.join(__dirname, '../../templates/SC3_template.pdf');
  if (!fs.existsSync(templatePath)) {
    throw new Error('SC3 template not found');
  }

  const bytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const form = pdfDoc.getForm();
  const fieldNames = new Set(form.getFields().map(f => f.getName()));

  const setIfExists = (name, value, opts = {}) => {
    if (!fieldNames.has(name)) return;
    if (!hasValue(value)) return;

    try {
      const field = form.getTextField(name);
      const text = String(value);

      field.setText(text);

      const maxSize = opts.maxSize ?? 10;
      const minSize = opts.minSize ?? 6;
      const threshold = opts.threshold ?? 12;

      // Smaller text for longer values
      const size =
        text.length <= threshold
          ? maxSize
          : Math.max(minSize, Math.floor(maxSize - (text.length - threshold) * 0.5));

      field.setFontSize(size);
    } catch (_) {}
  };

  const rows = normalizeRows(data);

  for (let i = 1; i <= Math.min(17, rows.length); i++) {
    const row = rows[i - 1] || {};

    // Skip completely empty rows so the PDF only fills used rows
    const rowHasContent =
      hasValue(row.date) ||
      hasValue(row.food) ||
      hasValue(row.time_started_cooking) ||
      hasValue(row.time_finished_cooking) ||
      hasValue(row.core_temp) ||
      hasValue(row.cooling_date) ||
      hasValue(row.time_into_fridge) ||
      hasValue(row.reheating_date) ||
      hasValue(row.reheating_core_temp) ||
      hasValue(row.comment);

    if (!rowHasContent) continue;

    // setIfExists(`date_${i}`, row.date);
    setIfExists(`date_${i}`, row.date, { maxSize: 8, minSize: 5, threshold: 10 });
    setIfExists(`food_${i}`, row.food);
    setIfExists(`time_started_cooking_${i}`, row.time_started_cooking);
    setIfExists(`time_finished_cooking_${i}`, row.time_finished_cooking);
    setIfExists(`core_temp_${i}`, row.core_temp);

    // Each row belongs to exactly one section (see buildSc3Payload in sc3.controller.js) -
    // a fallback sign must not be written into the OTHER two sections' sign fields just
    // because a row happens to have any content, or the PDF ends up falsely attesting a
    // cooling/reheating check that was never actually recorded for that row.
    const fallbackSign = data.sign || data.employee_name || '';
    const hasCookingContent = hasValue(row.date) || hasValue(row.food) || hasValue(row.time_started_cooking) || hasValue(row.time_finished_cooking) || hasValue(row.core_temp);
    const hasCoolingContent = hasValue(row.cooling_date) || hasValue(row.time_into_fridge);
    const hasReheatingContent = hasValue(row.reheating_date) || hasValue(row.reheating_core_temp);

    if (hasCookingContent) {
      setIfExists(`cooking_sign_${i}`, row.cooking_sign || fallbackSign);
    }

    // setIfExists(`cooling_date_${i}`, row.cooling_date);
    setIfExists(`cooling_date_${i}`, row.cooling_date, { maxSize: 8, minSize: 5, threshold: 10 });
    setIfExists(`time_into_fridge_${i}`, row.time_into_fridge);
    if (hasCoolingContent) {
      setIfExists(`cooling_sign_${i}`, row.cooling_sign || fallbackSign);
    }

    setIfExists(`reheating_date_${i}`, row.reheating_date, { maxSize: 8, minSize: 5, threshold: 10 });
    setIfExists(`reheating_core_temp_${i}`, row.reheating_core_temp);
    if (hasReheatingContent) {
      setIfExists(`reheating_sign_${i}`, row.reheating_sign || fallbackSign);
    }

    setIfExists(`comment_${i}`, row.comment, { maxSize: 8, minSize: 5, threshold: 10 });
  }

  // Optional top-level fields
  setIfExists('Employee', data.employee_name || data.employee, { maxSize: 8, minSize: 5, threshold: 10 });
  setIfExists('Date', data.date);

  form.flatten();

  const safeEmp = String(data.employee_name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
  const date = String(new Date().toLocaleDateString('en-GB')).replace(/\//g, '-'); //dd-mm-yyyy format
  // Trailing timestamp keeps this unique per submission - see fillSc1.js for why (no UNIQUE
  // constraint on file_name, so same-day same-name collisions produce a duplicate row and a
  // delete only removes the newest, orphaning the other's R2 object).
  const fileName = `SC3-${date}-${safeEmp}-${Date.now()}.pdf`;

  const output = await pdfDoc.save();

  return { fileName, pdfBuffer: output };
};