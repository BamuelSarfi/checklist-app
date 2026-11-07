const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { formatInTimeZone } = require('./sfbbPdfTime');

const PAGE = { width: 595.28, height: 841.89, margin: 44 };
const INK = rgb(0.125, 0.118, 0.114);
const MUTED = rgb(0.42, 0.42, 0.42);
const GREEN = rgb(0.298, 0.686, 0.314);
const RULE = rgb(0.82, 0.82, 0.82);
const ATTRIBUTION = 'Layout by SafeCater, based on Safer Food, Better Business (Food Standards Agency) under the Open Government Licence v3.0. SafeCater is not affiliated with the FSA.';
const OTHER_LANGUAGE = '[written in another language]';

// The built-in PDF fonts only cover Western European letters. Accents outside that set are reduced
// to their base letter, and text in another script is marked rather than printed as gibberish, with
// the original kept in the record's data.
const LETTER_FALLBACKS = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ß: 'ss', ø: 'o', Ø: 'O' };

function canEncode(font, text) {
  try {
    font.encodeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

function pdfSafe(font, value) {
  const output = [];
  let skipping = false;
  for (const char of String(value ?? '').replace(/[\r\n\t]+/g, ' ')) {
    let safe = canEncode(font, char) ? char : null;
    if (safe === null) {
      const reduced = (LETTER_FALLBACKS[char] || char.normalize('NFKD').replace(/[̀-ͯ]/g, ''));
      if (reduced && reduced !== char && canEncode(font, reduced)) safe = reduced;
    }
    if (safe !== null) {
      if (skipping && safe.trim() === '') continue;
      output.push(safe);
      skipping = false;
    } else if (!skipping) {
      output.push(`${OTHER_LANGUAGE} `);
      skipping = true;
    }
  }
  return output.join('').replace(/\s+/g, ' ').trim();
}

function wrap(font, text, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) <= width || !line) {
      line = attempt;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class Sheet {
  static async create(heading) {
    const sheet = new Sheet();
    sheet.doc = await PDFDocument.create();
    sheet.regular = await sheet.doc.embedFont(StandardFonts.Helvetica);
    sheet.bold = await sheet.doc.embedFont(StandardFonts.HelveticaBold);
    sheet.heading = heading;
    sheet.addPage();
    return sheet;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
    this.page.drawText(pdfSafe(this.regular, this.heading), { x: PAGE.margin, y: PAGE.margin - 18, size: 7.5, font: this.regular, color: MUTED });
    wrap(this.regular, ATTRIBUTION, 6.5, PAGE.width - PAGE.margin * 2).forEach((line, index) => {
      this.page.drawText(line, { x: PAGE.margin, y: PAGE.margin - 28 - index * 8, size: 6.5, font: this.regular, color: MUTED });
    });
  }

  room(height) {
    if (this.y - height < PAGE.margin + 4) this.addPage();
  }

  text(value, { size = 10, bold = false, color = INK, indent = 0, after = 3 } = {}) {
    const font = bold ? this.bold : this.regular;
    const lines = wrap(font, pdfSafe(font, value), size, PAGE.width - PAGE.margin * 2 - indent);
    for (const line of lines) {
      this.room(size + 3);
      this.y -= size + 2;
      this.page.drawText(line, { x: PAGE.margin + indent, y: this.y, size, font, color });
    }
    this.y -= after;
  }

  title(value, subtitle) {
    this.text(value, { size: 20, bold: true, after: 4 });
    if (subtitle) this.text(subtitle, { size: 11, color: MUTED, after: 12 });
  }

  section(value) {
    this.room(34);
    this.y -= 10;
    this.text(value, { size: 12, bold: true, after: 4 });
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.width - PAGE.margin, y: this.y }, thickness: 0.75, color: RULE });
    this.y -= 6;
  }

  check(value, done) {
    const lines = wrap(this.regular, pdfSafe(this.regular, value), 10, PAGE.width - PAGE.margin * 2 - 20);
    this.room(lines.length * 12 + 4);
    const top = this.y - 11;
    this.page.drawRectangle({ x: PAGE.margin, y: top, width: 10, height: 10, borderColor: done ? GREEN : MUTED, borderWidth: 1, color: done ? GREEN : undefined });
    if (done) {
      const white = rgb(1, 1, 1);
      this.page.drawLine({ start: { x: PAGE.margin + 2, y: top + 5 }, end: { x: PAGE.margin + 4.2, y: top + 2.5 }, thickness: 1.3, color: white });
      this.page.drawLine({ start: { x: PAGE.margin + 4.2, y: top + 2.5 }, end: { x: PAGE.margin + 8.2, y: top + 7.6 }, thickness: 1.3, color: white });
    }
    for (const line of lines) {
      this.y -= 12;
      this.page.drawText(line, { x: PAGE.margin + 18, y: this.y, size: 10, font: this.regular, color: INK });
    }
    this.y -= 4;
  }

  async finish() {
    return this.doc.save();
  }
}

function ukDate(dateIso) {
  const [year, month, day] = String(dateIso).split('-');
  return `${day}/${month}/${year}`;
}

function who(entry, nameKey = 'by', timeKey = 'at') {
  return [entry?.[nameKey], entry?.[timeKey] ? formatInTimeZone(entry[timeKey]) : null].filter(Boolean).join(', ');
}

function drawChecks(sheet, title, section) {
  sheet.section(title);
  if (!section?.completed_at) {
    sheet.text('Not completed.', { color: MUTED });
    return;
  }
  (section.items || []).forEach((item) => sheet.check(item.text, item.done));
  sheet.text(`Completed by ${who(section, 'completed_by', 'completed_at')}${section.late ? ' (entered late)' : ''}`, { size: 9, color: MUTED, after: 2 });
}

async function renderDiaryDay({ day, kitchenName }) {
  const sheet = await Sheet.create(`${kitchenName || 'Kitchen'}, daily diary ${ukDate(day.date)}`);
  sheet.title('Daily diary', `${kitchenName || 'Kitchen'}, ${ukDate(day.date)}`);
  drawChecks(sheet, 'Opening checks', day.opening);

  sheet.section('Prove it');
  if (day.prove_it?.length) {
    day.prove_it.forEach((entry) => sheet.text(`${entry.method}: ${entry.text}. ${who(entry)}${entry.warning ? `. ${entry.warning}` : ''}`, { size: 10 }));
  } else {
    sheet.text('None recorded.', { color: MUTED });
  }

  sheet.section('Extra checks');
  if (day.extra_checks?.length) {
    day.extra_checks.forEach((entry) => sheet.text(`${entry.kind}${entry.details ? `: ${entry.details}` : ''}. ${who(entry)}`, { size: 10 }));
  } else {
    sheet.text('None recorded.', { color: MUTED });
  }

  sheet.section('Any problems or changes, and what you did');
  if (day.problems?.length) {
    day.problems.forEach((entry) => sheet.text(`${entry.text}. ${who(entry)}`, { size: 10 }));
  } else {
    sheet.text('None recorded.', { color: MUTED });
  }

  drawChecks(sheet, 'Closing checks', day.closing);

  sheet.section('Sign-off');
  sheet.text('Our safe methods were followed and effectively supervised today.', { size: 11, bold: true });
  if (day.signoff) {
    sheet.text(`Name: ${day.signoff.by}`);
    sheet.text(`Signed with their personal PIN: ${formatInTimeZone(day.signoff.at)}${day.signoff.late ? ' (signed late)' : ''}`);
  }
  return sheet.finish();
}

const REVIEW_ROWS = [
  ['reviewed_safe_methods', 'Have you reviewed your safe methods?'],
  ['allergens_updated', 'Has allergen information been updated for any changes to menu items or ingredients?'],
  ['changed_equipment', 'Have you changed any equipment or processes?'],
  ['new_suppliers', 'Have you recorded any new suppliers?'],
  ['cleaning_schedule', 'Does your cleaning schedule need updating?'],
  ['new_staff_trained', 'Have new staff been trained in all safe methods?'],
  ['refresher_needed', 'Do existing staff need refresher training?'],
  ['extra_checks_needed', 'Are extra opening or closing checks required?'],
  ['complaints_investigated', 'Have food complaints been investigated?'],
  ['probes_calibrated', 'Have probes been calibrated in the last 4 weeks and recorded?'],
  ['extra_checks_weekly', 'Have extra checks been completed and recorded weekly?'],
  ['prove_it_recorded', 'Have Prove it checks been regularly recorded?'],
];

async function renderReview({ review, kitchenName }) {
  const sheet = await Sheet.create(`${kitchenName || 'Kitchen'}, 4-weekly review ${ukDate(review.date)}`);
  sheet.title('4-weekly review', `${kitchenName || 'Kitchen'}, ${ukDate(review.date)}`);
  sheet.section('Walk round');
  sheet.text(`Did you observe any problems, or did the same issue occur in the diary three times or more? ${review.problems_observed ? 'Yes' : 'No'}`);
  if (review.problems_observed) {
    sheet.text(`Details: ${review.problem_details || ''}`);
    sheet.text(`What did you do about it? ${review.problem_action || ''}`);
  }
  sheet.section('Review');
  REVIEW_ROWS.forEach(([key, label]) => {
    sheet.text(`${label} ${review.answers?.[key] === true ? 'Yes' : 'No'}`);
  });
  if (review.additional_details) {
    sheet.section('Additional details');
    sheet.text(review.additional_details);
  }
  sheet.section('Sign-off');
  sheet.text(`Name: ${review.signed_by}`);
  sheet.text(`Signed with their personal PIN: ${formatInTimeZone(review.signed_at)}`);
  return sheet.finish();
}

module.exports = { renderDiaryDay, renderReview, REVIEW_ROWS, pdfSafe };
