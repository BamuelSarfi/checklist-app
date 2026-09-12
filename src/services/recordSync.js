function hasRemoteRecordSync() {
  return Boolean(
    process.env.SAFECATER_BASE_API_URL &&
    process.env.SAFECATER_KITCHEN_ID &&
    process.env.SAFECATER_SERVICE_API_KEY
  );
}

function getRemoteBaseUrl() {
  return String(process.env.SAFECATER_BASE_API_URL || '').replace(/\/$/, '');
}

// 20s, not employeeDirectory.js's 5s - this carries a base64 PDF/image body, not a small
// JSON lookup, so it needs more headroom before being considered hung.
const SYNC_TIMEOUT_MS = 20000;

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable');
  }

  // Without this, a portal that accepts the connection but stalls (DB lock, slow R2 write)
  // hangs this call indefinitely - the callers below are awaited synchronously in the PDF
  // generation request path, contradicting their own "best-effort, non-blocking" contract.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`Remote sync request failed with ${response.status}: ${body}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const SUBSCRIPTION_INACTIVE_MESSAGE =
  "This record was saved, but syncing to SafeCater is paused because this kitchen's subscription is inactive. Ask your manager to reactivate billing so records start syncing again.";

// Mirrors a generated PDF to checklist-app-fend. Best-effort and non-blocking - the PDF is
// already durably stored in R2 (see generatedRecords.js) by the time this is called, so a
// failure here never means the record is unsaved, only that the cloud copy is pending.
async function uploadGeneratedPdf({ fileName, recordType, recordDate, employeeId, employeeName, payload = {}, pdfBuffer }) {
  if (!hasRemoteRecordSync()) {
    return { record: null, syncStatus: 'disabled' };
  }

  try {
    const kitchenId = String(process.env.SAFECATER_KITCHEN_ID || '').trim();
    // Defensive: a plain Uint8Array (e.g. straight from pdf-lib's pdfDoc.save()) silently
    // produces a comma-joined decimal-byte string here instead of base64 - no error, but the
    // resulting "PDF" decodes to ~1 byte on the other end. generatedRecords.js already
    // normalizes this before calling here; this guards any other caller too.
    const pdfBase64 = (Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer)).toString('base64');
    const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(kitchenId)}/records`;
    const response = await fetchJson(url, {
      method: 'POST',
      headers: {
        'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        employee_id: employeeId || null,
        employee_name: employeeName || 'Employee',
        record_type: recordType,
        record_date: recordDate,
        file_name: fileName,
        pdf_data_url: `data:application/pdf;base64,${pdfBase64}`,
        payload_jsonb: payload,
      }),
    });

    return { record: response.record || null, syncStatus: 'synced' };
  } catch (error) {
    if (error.status === 402) {
      console.warn('PDF upload to SafeCater backend skipped: kitchen subscription is inactive');
      return { record: null, syncStatus: 'subscription_inactive', syncMessage: SUBSCRIPTION_INACTIVE_MESSAGE };
    }

    console.warn('PDF upload to SafeCater backend failed:', error.message);
    return { record: null, syncStatus: 'error', syncMessage: error.message };
  }
}

// Mirrors a captured document (e.g. a photographed delivery note or pest control record)
// to checklist-app-fend, same best-effort/non-blocking contract as uploadGeneratedPdf but
// using the fend endpoint's generic file_data_url/content_type fields instead of assuming
// PDF, since a capture is typically a JPEG/PNG straight from the device camera.
async function uploadCapturedDocument({ fileName, recordType, recordDate, employeeId, employeeName, payload = {}, buffer, contentType }) {
  if (!hasRemoteRecordSync()) {
    return { record: null, syncStatus: 'disabled' };
  }

  try {
    const kitchenId = String(process.env.SAFECATER_KITCHEN_ID || '').trim();
    // Defensive - see the matching comment in uploadGeneratedPdf above.
    const fileBase64 = (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).toString('base64');
    const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(kitchenId)}/records`;
    const response = await fetchJson(url, {
      method: 'POST',
      headers: {
        'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        employee_id: employeeId || null,
        employee_name: employeeName || 'Employee',
        record_type: recordType,
        record_date: recordDate,
        file_name: fileName,
        file_data_url: `data:${contentType};base64,${fileBase64}`,
        content_type: contentType,
        payload_jsonb: payload,
      }),
    });

    return { record: response.record || null, syncStatus: 'synced' };
  } catch (error) {
    if (error.status === 402) {
      console.warn('Document upload to SafeCater backend skipped: kitchen subscription is inactive');
      return { record: null, syncStatus: 'subscription_inactive', syncMessage: SUBSCRIPTION_INACTIVE_MESSAGE };
    }

    console.warn('Document upload to SafeCater backend failed:', error.message);
    return { record: null, syncStatus: 'error', syncMessage: error.message };
  }
}

async function deleteSyncedPdf({ fendStorageKey, kitchenId } = {}) {
  if (!hasRemoteRecordSync() || !fendStorageKey) {
    return false;
  }

  try {
    const resolvedKitchenId = String(kitchenId || process.env.SAFECATER_KITCHEN_ID || '').trim();
    if (!resolvedKitchenId) {
      return false;
    }

    const url = `${getRemoteBaseUrl()}/api/v1/tenant/${encodeURIComponent(resolvedKitchenId)}/records/${encodeURIComponent(fendStorageKey)}`;
    await fetchJson(url, {
      method: 'DELETE',
      headers: {
        'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
      },
    });

    return true;
  } catch (error) {
    if (error.status === 402) {
      console.warn('PDF delete sync with SafeCater backend skipped: kitchen subscription is inactive');
    } else {
      console.warn('PDF delete sync with SafeCater backend failed:', error.message);
    }
    return false;
  }
}

module.exports = {
  uploadGeneratedPdf,
  uploadCapturedDocument,
  deleteSyncedPdf,
};
