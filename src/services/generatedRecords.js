const { query } = require('../config/db');
const storage = require('../config/storage');
const { uploadGeneratedPdf, uploadCapturedDocument, deleteSyncedPdf } = require('./recordSync');

function getKitchenId() {
  return String(process.env.SAFECATER_KITCHEN_ID || '');
}

const EXTENSION_CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function contentTypeForKey(key) {
  const extension = String(key || '').split('.').pop().toLowerCase();
  return EXTENSION_CONTENT_TYPES[extension] || 'application/octet-stream';
}

// Single entry point for "a form generated a final PDF" - replaces the old pattern of
// writing the PDF to local disk and separately mirroring it to checklist-app-fend. The PDF
// is uploaded to R2 first (so the save is durable regardless of what happens next), then
// mirrored to checklist-app-fend (best-effort, unchanged behavior), then both storage
// locations are recorded in one generated_records row - that row replaces both the local
// file and records/.safecater-sync.json. file_name is kept as the app-wide identifier for
// a record (library.html, the /records/:fileName download route, and delete-by-name all
// already work off it) - it's not a database primary key, just a stable display/lookup name.
async function saveGeneratedRecord({ fileName, recordType, recordDate, employeeId, employeeName, payload = {}, pdfBuffer }) {
  // pdf-lib's pdfDoc.save() returns a plain Uint8Array, not a Node Buffer. storage.uploadPdf
  // (below) already coerces this correctly before handing it to the S3 SDK, but
  // recordSync.js's uploadGeneratedPdf calls pdfBuffer.toString('base64') directly - on a
  // raw Uint8Array that silently calls Array.prototype.toString instead (ignoring the
  // 'base64' argument entirely, no error thrown), producing a comma-separated list of
  // decimal byte values instead of base64. That string's embedded commas then get mangled by
  // the data: URL's split(',').pop() parsing on the portal side, landing on a 1-byte
  // fragment - every kiosk-synced record was silently corrupted to 1 byte in R2 this way
  // (confirmed live: the kiosk's own copy was a valid multi-hundred-KB PDF, only the synced
  // copy was broken). Converting once here, up front, means every consumer below gets a real
  // Buffer regardless of what pdf-lib (or any future caller) hands in.
  const normalizedBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);

  const r2Key = storage.buildPdfKey({ recordType, recordDate, employeeName });
  await storage.uploadPdf(r2Key, normalizedBuffer);

  const { record, syncStatus, syncMessage } = await uploadGeneratedPdf({
    fileName,
    recordType,
    recordDate,
    employeeId,
    employeeName,
    payload,
    pdfBuffer: normalizedBuffer,
  });

  const result = await query(
    `INSERT INTO generated_records (
        kitchen_id, record_type, record_date, employee_id, employee_name, file_name, r2_key, fend_storage_key, fend_record_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      getKitchenId(),
      recordType,
      recordDate,
      employeeId ? String(employeeId) : null,
      employeeName || null,
      fileName,
      r2Key,
      record?.storage_key || null,
      record?.id || null,
    ]
  );

  return { id: result.rows[0].id, fileName, r2Key, syncStatus, syncMessage };
}

// Same pipeline as saveGeneratedRecord (upload to R2, mirror to fend, record one row) but
// for an arbitrary captured document (e.g. a photographed delivery note or pest control
// certificate) rather than a generated SC-form PDF - kept separate from saveGeneratedRecord
// so the existing, well-exercised SC-form path is untouched.
async function saveCapturedDocument({ fileName, recordType, recordDate, employeeId, employeeName, payload = {}, buffer, contentType }) {
  // Same normalization as saveGeneratedRecord above - defensive here since today's only
  // caller (server.js's upload route) already passes a real Buffer, but recordSync.js's
  // uploadCapturedDocument has the identical toString('base64') hazard for any future caller
  // that doesn't.
  const normalizedBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const extension = String(contentType || '').split('/').pop().replace(/[^a-z0-9]/gi, '') || 'bin';
  const r2Key = storage.buildFileKey({ recordType, recordDate, employeeName, extension });
  await storage.uploadFile(r2Key, normalizedBuffer, contentType);

  const { record, syncStatus, syncMessage } = await uploadCapturedDocument({
    fileName,
    recordType,
    recordDate,
    employeeId,
    employeeName,
    payload,
    buffer: normalizedBuffer,
    contentType,
  });

  const result = await query(
    `INSERT INTO generated_records (
        kitchen_id, record_type, record_date, employee_id, employee_name, file_name, r2_key, fend_storage_key, fend_record_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      getKitchenId(),
      recordType,
      recordDate,
      employeeId ? String(employeeId) : null,
      employeeName || null,
      fileName,
      r2Key,
      record?.storage_key || null,
      record?.id || null,
    ]
  );

  return { id: result.rows[0].id, fileName, r2Key, syncStatus, syncMessage };
}

// Record types that never appear in the kiosk library - currently just SC7, an optional
// employee self-assessment that's reviewed on the SafeCater portal dashboard instead, not
// browsed/deleted locally like the other SC-form PDFs.
const EXCLUDED_FROM_LIBRARY_TYPES = ['SC7'];

async function listRecordFileNames() {
  const result = await query(
    `SELECT file_name FROM generated_records
     WHERE kitchen_id = $1 AND deleted_at IS NULL AND record_type != ALL($2)
     ORDER BY created_at DESC`,
    [getKitchenId(), EXCLUDED_FROM_LIBRARY_TYPES]
  );

  return result.rows.map((row) => row.file_name);
}

// Public/unauthenticated equivalent of listRecordFileNames - deliberately excludes
// file_name and employee_name (a real food-safety record's file_name embeds the employee's
// name, e.g. "SC1-12-09-2026-John_Doe.pdf") so the Library page can be viewed without staff
// login without exposing who was on shift. `id` (a random UUID, not a database identity an
// attacker could enumerate sequentially) is the only public handle - getPublicRecordById
// below resolves it back to a real file server-side.
async function listPublicRecordSummaries() {
  const result = await query(
    `SELECT id, record_type, record_date FROM generated_records
     WHERE kitchen_id = $1 AND deleted_at IS NULL AND record_type != ALL($2)
     ORDER BY created_at DESC`,
    [getKitchenId(), EXCLUDED_FROM_LIBRARY_TYPES]
  );

  return result.rows;
}

// Kitchen-scoped by design, same as every other lookup here - a record id from one kitchen's
// container can never resolve to another kitchen's file, even though the id itself carries
// no kitchen information (it's a random UUID).
async function getPublicRecordById(id) {
  const result = await query(
    `SELECT id, r2_key, record_type, record_date FROM generated_records
     WHERE id = $1 AND kitchen_id = $2 AND deleted_at IS NULL`,
    [id, getKitchenId()]
  );

  return result.rows[0] || null;
}

// Replaces the old /api/completed-checklists' fs.readdirSync + DD-MM-YYYY filename-prefix
// guessing (which CLAUDE.md flagged as never actually matching SC2/SC4's different naming
// scheme). record_date is a real column here, so this checks all five form types uniformly.
async function listRecordTypesForDate(recordDateIso) {
  const result = await query(
    `SELECT DISTINCT record_type FROM generated_records
     WHERE kitchen_id = $1 AND record_date = $2 AND deleted_at IS NULL`,
    [getKitchenId(), recordDateIso]
  );

  return result.rows.map((row) => row.record_type);
}

async function getDownloadByFileName(fileName, { disposition = 'inline' } = {}) {
  const result = await query(
    `SELECT r2_key, file_name FROM generated_records
     WHERE file_name = $1 AND kitchen_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [fileName, getKitchenId()]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const url = await storage.getDownloadUrl(row.r2_key, { downloadName: row.file_name, contentType: contentTypeForKey(row.r2_key), disposition });
  return { url, fileName: row.file_name };
}

async function deleteGeneratedRecordByFileName(fileName) {
  const result = await query(
    `SELECT id, r2_key, fend_storage_key, kitchen_id FROM generated_records
     WHERE file_name = $1 AND kitchen_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [fileName, getKitchenId()]
  );

  const row = result.rows[0];
  if (!row) {
    return false;
  }

  await storage.deleteObject(row.r2_key);
  if (row.fend_storage_key) {
    await deleteSyncedPdf({ fendStorageKey: row.fend_storage_key, kitchenId: row.kitchen_id });
  }
  await query('UPDATE generated_records SET deleted_at = now() WHERE id = $1', [row.id]);

  return true;
}

module.exports = {
  saveGeneratedRecord,
  saveCapturedDocument,
  listRecordFileNames,
  listPublicRecordSummaries,
  getPublicRecordById,
  listRecordTypesForDate,
  getDownloadByFileName,
  deleteGeneratedRecordByFileName,
};
