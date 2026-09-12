// Last-resort safety net, not the primary fix - errors should be caught at their source
// (try/catch around a request handler, an explicit `res.on('error', ...)`/`stream.on('error',
// ...)` next to anything piped into a response, etc.). Express 5 already auto-catches a
// rejected promise from an async route handler, so this exists for what that *doesn't*
// cover: a stray event-emitter 'error' (e.g. a stream still flushing queued writes to an
// already-ended response after some other error closed it), a timer callback, or anything
// else outside the request/response promise chain. Without a listener, Node treats either of
// these as fatal and kills the entire process - the one kiosk this deployment serves goes
// fully offline, not just the one request that hit the bug. Logging clearly and exiting
// (rather than trying to "recover" and keep serving) is deliberate: process state after an
// uncaught exception may be corrupted in ways that are unsafe to just ignore - the process
// manager (nodemon in dev, the hosting platform's restart policy in production) is what
// brings a clean process back up.
process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException', err && err.stack ? err.stack : err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection', reason && reason.stack ? reason.stack : reason);
    process.exit(1);
});

const express = require('express');
const crypto = require('crypto');
const sc5Routes = require('./src/routes/sc5.routes');
const sc7Routes = require('./src/routes/sc7.routes');
const sc3Routes = require('./src/routes/sc3.routes');
const sc2Routes = require('./src/routes/sc2.routes');
const sc1Routes = require('./src/routes/sc1.routes');
const unclesMarketPageRoutes = require('./src/routes/unclesmarket.routes');
const unclesMarketApiRoutes = require('./src/routes/unclesmarket.api.routes');
const unclesMarketController = require('./src/controllers/unclesmarket.controller');
const testerPromotionRoutes = require('./src/routes/testerPromotion.routes');
const naaTesterClaimRoutes = require('./src/routes/naaTesterClaim.routes');
const naaTesterClaimController = require('./src/controllers/naaTesterClaim.controller');
const cookieParser = require('cookie-parser');
const authenticateEmployee = require('./src/middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const { authenticateEmployeePin } = require('./src/services/employeeDirectory');
const generatedRecords = require('./src/services/generatedRecords');
const checklistDrafts = require('./src/services/checklistDrafts');
//use .env file for environment variables
require('dotenv').config();

// Fail fast: this app now persists exclusively to Postgres + R2 (see migrations/,
// src/config/db.js, src/config/storage.js) - there is no local-disk fallback left to
// silently degrade to, so a missing var should stop the app at boot, not surface as a
// broken save the first time a kitchen worker submits a form.
const REQUIRED_ENV_VARS = [
    'DATABASE_URL',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'COOKIE_SECRET',
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variable(s): ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

const app = express();
const path = require('path');

// Meta signs the raw webhook body (X-Hub-Signature-256, verified in whatsappService.js) -
// must be registered before the global express.json() below, matching checklist-app-fend's
// Stripe webhook pattern, since JSON-parsing the body first would consume the stream and
// leave nothing to verify the signature against.
if (process.env.ENABLE_TESTER_PROMOTION === 'true') {
  app.get('/api/webhooks/whatsapp', naaTesterClaimController.webhookVerify);
  app.post('/api/webhooks/whatsapp', express.raw({ type: 'application/json' }), naaTesterClaimController.webhookReceive);
}

//
// Middleware
// 15mb accommodates a base64-encoded photo from the document-capture feature (default
// 100kb is far too small for that; existing JSON payloads are all well under this).
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
// Signed so the auth middleware can tell a genuinely-issued cookie from one an attacker
// just wrote via devtools/a MITM on plain HTTP - previously employeeId/sessionToken were
// checked only for "does this employee exist", so setting employeeId to any other real
// employee's id was enough to fully impersonate them (see auth.middleware.js).
app.use(cookieParser(process.env.COOKIE_SECRET));

// This kiosk is scoped to a single kitchen (SAFECATER_KITCHEN_ID is fixed per deployment),
// so this limiter is effectively already a per-device lockout across every employee's PIN,
// not just a generic anti-abuse cap - 30/15min is far below what's needed for real staff
// login traffic but makes brute-forcing the 1,000,000 possible 6-digit PINs impractical
// (a real per-account lockout isn't meaningful here since PIN-only login has no separate
// identity to lock until after a PIN already matches).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/login', loginLimiter);
app.use('/api/auth', loginLimiter);

// LOGIN ROUTE (unprotected)
app.get('/login', (req, res) => {

  // if (req.cookies.employeeId && req.cookies.sessionToken) {
  //   return res.redirect('/dashboard');
  // }
  res.sendFile(path.join(__dirname, 'src/views/login.html'));
});

app.get('/:kitchenSlug/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/login.html'));
});

app.post('/login', async (req, res) => {
  const { pin } = req.body;
  const cleanPin = String(pin || '').trim();

  if (!/^\d{6}$/.test(cleanPin)) {
    return res.status(400).json({ success: false, message: 'PIN must be 6 digits' });
  }

  try {
    const employee = await authenticateEmployeePin(cleanPin);

    if (!employee) {
      return res.status(401).json({ success: false, message: 'Invalid PIN' });
    }

    // Cryptographically random - Math.random() + Date.now() was predictable enough that an
    // attacker could guess active session tokens outright.
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const cookieOptions = {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      // Enforced only in production so local HTTP dev (this app has no HTTPS/proxy setup
      // in dev, per its own docs) keeps working; a real deployment behind HTTPS gets the
      // full protection.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      signed: true,
    };

    // Set cookies (expires in 24 hours)
    res.cookie('employeeId', employee.id, cookieOptions);
    res.cookie('sessionToken', sessionToken, cookieOptions);
    res.cookie('employeeName', employee.name, cookieOptions);

    return res.json({
      success: true,
      message: 'Login successful',
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        preferred_language: employee.preferred_language,
        email: employee.email,
        location: employee.location
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// LOGOUT ROUTE
app.get('/logout', (req, res) => {
  res.clearCookie('employeeId');
  res.clearCookie('sessionToken');
  res.clearCookie('employeeName');
  res.redirect('/');
});

// GET EMPLOYEE INFO (protected route)
app.get('/api/employee', authenticateEmployee, (req, res) => {
  try {
    res.json({
      success: true,
      employee: {
        id: req.employee.id,
        name: req.employee.name,
        role: req.employee.role,
        preferred_language: req.employee.preferred_language,
        email: req.employee.email,
        location: req.employee.location
      }
    });
  } catch (err) {
    console.error('Error fetching employee:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

async function resolveKitchenIdFromSlug(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();

  if (
    !cleanSlug ||
    !process.env.SAFECATER_BASE_API_URL ||
    !process.env.SAFECATER_SERVICE_API_KEY ||
    typeof fetch !== 'function'
  ) {
    return null;
  }

  const url = `${String(process.env.SAFECATER_BASE_API_URL).replace(/\/$/, '')}/api/v1/tenant/resolve?subdomain=${encodeURIComponent(cleanSlug)}`;
  const response = await fetch(url, {
    headers: {
      'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return payload?.kitchen?.id || null;
}

app.get('/api/brand', async (req, res) => {
  let kitchenId = null;
  // Reflects THIS deployment's own flag (whether the /unclesmarket routes exist on this
  // exact kiosk process), not whatever kitchen the brand data below happens to be about -
  // the home screen (index.html) uses this to decide whether to show the Uncle's Market
  // tile at all, since it's a business-specific bolt-on, not a module_type.
  const unclesMarketEnabled = process.env.ENABLE_UNCLES_MARKET === 'true';
  const testerPromotionEnabled = process.env.ENABLE_TESTER_PROMOTION === 'true';

  try {
    const requestedKitchenId = String(req.query.kitchen_id || req.query.kitchenId || '').trim();
    const requestedSlug = String(req.query.slug || req.query.subdomain || '').trim();
    kitchenId = requestedKitchenId;

    if (!kitchenId && requestedSlug) {
      kitchenId = await resolveKitchenIdFromSlug(requestedSlug);
    }

    if (!kitchenId) {
      kitchenId = String(process.env.SAFECATER_KITCHEN_ID || '').trim();
    }

    if (
      process.env.SAFECATER_BASE_API_URL &&
      kitchenId &&
      process.env.SAFECATER_SERVICE_API_KEY &&
      typeof fetch === 'function'
    ) {
      const url = `${String(process.env.SAFECATER_BASE_API_URL).replace(/\/$/, '')}/api/v1/tenant/${encodeURIComponent(kitchenId)}/brand`;
      const response = await fetch(url, {
        headers: {
          'x-safecater-service-key': process.env.SAFECATER_SERVICE_API_KEY,
        },
      });

      if (response.ok) {
        const brandData = await response.json();
        return res.json({ ...brandData, uncles_market_enabled: unclesMarketEnabled, tester_promotion_enabled: testerPromotionEnabled });
      }

      const body = await response.text().catch(() => '');
      console.warn('Brand lookup failed:', response.status, body);
    }

    return res.json({
      brand_name: 'Safe Catering',
      logo_src: '/asset2.png',
      kitchen_name: null,
      kitchen_id: kitchenId || null,
      business: {
        display_name: 'Safe Catering',
        logo_src: '/asset2.png',
      },
      kitchen: null,
      uncles_market_enabled: unclesMarketEnabled,
      tester_promotion_enabled: testerPromotionEnabled,
    });
  } catch (err) {
    console.error('Error fetching brand info:', err);
    return res.json({
      brand_name: 'Safe Catering',
      logo_src: '/asset2.png',
      kitchen_name: null,
      kitchen_id: kitchenId || null,
      business: {
        display_name: 'Safe Catering',
        logo_src: '/asset2.png',
      },
      kitchen: null,
      uncles_market_enabled: unclesMarketEnabled,
      tester_promotion_enabled: testerPromotionEnabled,
    });
  }
});

// GET COMPLETED CHECKLISTS FOR TODAY (protected route)
app.get('/api/completed-checklists', authenticateEmployee, async (req, res) => {
  try {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const typesToday = await generatedRecords.listRecordTypesForDate(todayIso);

    // Unlike SC1/SC3/SC4/SC5 (fill-once-and-submit forms with no draft concept, or where
    // "completed" already means "submitted"), SC2 is a shared day-log an employee saves
    // progressively throughout the day and only "exports" into a PDF occasionally (the
    // export bundles the whole month, not just today) - requiring an export to count today
    // as done meant a fully-filled-in day still showed as "not completed" until someone
    // separately clicked export. A saved draft for today is now enough.
    const sc2Draft = await checklistDrafts.getDraft('SC2', now.getFullYear(), now.getMonth() + 1, now.getDate(), '');

    const completed = {
      sc5: typesToday.includes('SC5'),
      sc4: typesToday.includes('SC4'),
      sc3: typesToday.includes('SC3'),
      sc2: typesToday.includes('SC2') || Boolean(sc2Draft),
      sc1: typesToday.includes('SC1'),
    };

    res.json({
      success: true,
      completed
    });
  } catch (err) {
    console.error('Error fetching completed checklists:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET ALL RECORDS - lists every generated compliance record's filename for this kitchen.
// Was previously unauthenticated ("unprotected route"); that exposed real food-safety
// records (employee names, dates) to anyone on the internet with no login.
app.get('/api/records', authenticateEmployee, async (req, res) => {
  try {
    const records = await generatedRecords.listRecordFileNames();

    res.json({
      success: true,
      records
    });
  } catch (err) {
    console.error('Error fetching records:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// UPLOAD A CAPTURED DOCUMENT (e.g. delivery note, pest control record) - protected route.
// Accepts a base64 data URL from the client, same convention as the kitchen-logo upload on
// the portal side, rather than multipart/form-data (no multer dependency in this app).
const CAPTURE_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// The declared content-type above is just a client-supplied label on the data: URL - nothing
// stops a caller from sending arbitrary bytes (e.g. HTML with a script tag) tagged as
// "image/png". Checking the real file signature closes that gap without needing a new
// dependency for the small, fixed set of types this endpoint accepts.
function bufferMatchesContentType(buffer, contentType) {
  if (buffer.length < 4) return false;

  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (contentType === 'application/pdf') {
    return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }

  return false;
}

function sanitizeCustomTitleForFileName(rawTitle) {
  return String(rawTitle || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// record_type is client-supplied on this endpoint (unlike the SC1-SC7 controllers, which
// hardcode it) and was previously concatenated into the stored file_name/API response
// unsanitized - a value like "../../etc" or a quote/CRLF character would flow straight
// through into a DB column that's later echoed into API responses and, on the portal side,
// into a Content-Disposition filename. Same allowlist as sanitizeCustomTitleForFileName.
function sanitizeRecordTypeForFileName(rawRecordType) {
  return String(rawRecordType || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'custom_document';
}

// Rejects malformed strings AND calendar overflow (e.g. "2026-02-30" would otherwise
// silently parse via JS Date's day-rollover instead of being caught).
function isValidIsoDateNotFuture(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  return value <= new Date().toISOString().slice(0, 10);
}

app.post('/api/documents/upload', authenticateEmployee, async (req, res) => {
  try {
    const dataUrl = String(req.body.file_data_url || '').trim();
    const recordType = sanitizeRecordTypeForFileName(req.body.record_type);
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) {
      return res.status(400).json({ success: false, message: 'file_data_url must be a base64 data URL' });
    }

    const [, contentType, base64] = match;
    if (!CAPTURE_ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ success: false, message: `Unsupported file type: ${contentType}` });
    }

    const rawRecordDate = req.body.record_date != null ? String(req.body.record_date).trim() : '';
    const recordDate = rawRecordDate || new Date().toISOString().slice(0, 10);
    if (!isValidIsoDateNotFuture(recordDate)) {
      return res.status(400).json({ success: false, message: 'record_date must be a valid date (YYYY-MM-DD) and cannot be in the future' });
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!bufferMatchesContentType(buffer, contentType)) {
      return res.status(400).json({ success: false, message: 'File contents do not match the declared file type' });
    }

    const extension = contentType.split('/').pop();
    const employee = req.employee || {};
    const employeeName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Employee';

    const customTitle = String(req.body.custom_title || '').trim().slice(0, 120);
    const sanitizedTitle = sanitizeCustomTitleForFileName(customTitle);
    // recordDate + Date.now() stay in the filename regardless of title - generated_records
    // has no UNIQUE constraint on file_name, and download/delete-by-name both resolve via
    // "ORDER BY created_at DESC LIMIT 1", so dropping the timestamp when a title is present
    // would let two same-day uploads with the same title silently shadow each other.
    const fileNameBase = sanitizedTitle
      ? `${recordType}-${sanitizedTitle}-${recordDate}-${Date.now()}`
      : `${recordType}-${recordDate}-${Date.now()}`;
    const fileName = `${fileNameBase}.${extension}`;

    const notes = String(req.body.notes || '').trim().slice(0, 2000);
    const payload = {};
    if (customTitle) payload.custom_title = customTitle;
    if (notes) payload.notes = notes;

    const result = await generatedRecords.saveCapturedDocument({
      fileName,
      recordType,
      recordDate,
      employeeId: employee.id || null,
      employeeName,
      payload,
      buffer,
      contentType,
    });

    res.status(201).json({ success: true, fileName: result.fileName, syncStatus: result.syncStatus });
  } catch (err) {
    console.error('Error uploading captured document:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.delete('/api/records/:fileName', authenticateEmployee, async (req, res) => {
  try {
    const deleted = await generatedRecords.deleteGeneratedRecordByFileName(req.params.fileName);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.json({
      success: true,
      message: 'Record deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/privacy-policy.html'));
});

// SC2 DAILY FORM SUBMISSION (protected route)
const sc2Controller = require('./src/controllers/sc2.controller');
app.use('/api/sc2', sc2Routes);
// app.post('/api/sc2', authenticateEmployee, sc2Controller.submitForm);
// app.post('/api/sc2/draft', authenticateEmployee, sc2Controller.saveDraft);
// app.post('/api/sc2/reopen', authenticateEmployee, sc2Controller.reopenForEditing);
// app.get('/api/sc2/progress', authenticateEmployee, sc2Controller.getProgress);
// app.get('/api/sc2/today', authenticateEmployee, sc2Controller.getTodayData);
// app.post('/api/sc2/export', authenticateEmployee, sc2Controller.exportPdf);

// SC3 DAILY FORM SUBMISSION (protected route)
const sc3Controller = require('./src/controllers/sc3.controller');
app.use('/api/sc3', sc3Routes);
app.get('/api/sc3/today', authenticateEmployee, sc3Controller.getTodayData);

const sc4Controller = require('./src/controllers/sc4.controller');
app.post('/api/sc4/submit', authenticateEmployee, sc4Controller.submitForm);
app.post('/api/sc4/export', authenticateEmployee, sc4Controller.exportPdf);
app.get('/api/sc4/today', authenticateEmployee, sc4Controller.getTodayData);

// Protected routes
app.use('/sc5', authenticateEmployee, sc5Routes);
app.use('/sc7', authenticateEmployee, sc7Routes);
app.use('/sc4', authenticateEmployee, require('./src/routes/sc4.routes'));
app.use('/sc3', authenticateEmployee, sc3Routes);
app.use('/sc2', authenticateEmployee, sc2Routes);
app.use('/sc1', authenticateEmployee, sc1Routes);

// Uncle's Market - a business-specific bolt-on, not a shared SC-form: only this one
// kitchen's deployment sets ENABLE_UNCLES_MARKET=true, so every other kitchen's kiosk never
// mounts these routes at all (not just hides a nav link - the endpoints genuinely don't
// exist elsewhere).
if (process.env.ENABLE_UNCLES_MARKET === 'true') {
  app.use('/unclesmarket', authenticateEmployee, unclesMarketPageRoutes);
  app.use('/api/unclesmarket', authenticateEmployee, unclesMarketApiRoutes);

  // Monthly "export every section's PDF, even untouched ones" sweep. HTTP-triggered
  // (point a Scaleway Cron Trigger at this monthly, e.g. "0 2 1 * *") rather than an
  // in-process setInterval like the old standalone app used - this kiosk is meant to
  // scale to zero, and a sleeping container can't fire its own timer. Reuses the same
  // service-key secret this kiosk already holds for kiosk-to-portal calls rather than
  // inventing a second cron-only secret. Fails closed if the key is unset (unlike
  // tenantRoutes.js's M2M check on the portal side, which fails open - deliberately not
  // repeating that here).
  app.post('/internal/cron/unclesmarket-export', express.json(), async (req, res) => {
    const expectedKey = process.env.SAFECATER_SERVICE_API_KEY;
    if (!expectedKey || req.headers['x-safecater-service-key'] !== expectedKey) {
      return res.status(401).json({ success: false, message: 'Invalid or missing service key' });
    }

    try {
      const exportedFiles = await unclesMarketController.autoExportPreviousMonth();
      return res.json({ success: true, exported: exportedFiles });
    } catch (err) {
      console.error("Error running Uncle's Market monthly export:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
}

// Tester Promotion - another business-specific bolt-on, independent of
// ENABLE_UNCLES_MARKET (the cleaning checklist above) since the promotion runs on its own
// schedule and might be toggled separately. It is NOT part of the numbered SC1-SC7 form
// series, hence its own route names. /naa-tester-claim is deliberately NOT behind
// authenticateEmployee - it's the customer's own phone, no PIN session exists there.
if (process.env.ENABLE_TESTER_PROMOTION === 'true') {
  app.use('/tester-promotion', authenticateEmployee, testerPromotionRoutes);
  app.use('/api/tester-promotion', authenticateEmployee, testerPromotionRoutes);
  app.use('/naa-tester-claim', naaTesterClaimRoutes);
}

// Library page (protected)
app.get('/library', authenticateEmployee, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/library.html'));
});

// Home page (protected) - MUST be before static middleware
app.get('/', authenticateEmployee, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/index.html'));
});

// Serve generated PDFs by redirecting to a presigned R2 URL. Previously unprotected
// ("matching the previous static-file behavior") - that let anyone who obtained a
// fileName download a real compliance record with no login, permanently (the presigned
// URL itself expires, but nothing stopped re-requesting this route for a fresh one).
app.get('/records/:fileName', authenticateEmployee, async (req, res) => {
  try {
    const disposition = req.query.download ? 'attachment' : 'inline';
    const download = await generatedRecords.getDownloadByFileName(req.params.fileName, { disposition });
    if (!download) {
      return res.status(404).send('Not found');
    }

    return res.redirect(download.url);
  } catch (err) {
    console.error('Error resolving record download:', err);
    return res.status(500).send('Server error');
  }
});

// The static mount below serves every file in src/views by its literal filename, including
// index.html/sc1.html.../sc7.html - since express.static and the route handlers above match
// on distinct exact paths (e.g. app.get('/') never matches a request for "/index.html"),
// nothing above actually stops a page's auth gate from being bypassed by requesting its raw
// filename directly. Nothing in this app ever links to a literal .html URL (every internal
// navigation uses the clean paths above), so blocking the extension outright is safe.
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path)) {
    return res.redirect('/login');
  }
  next();
});

// Static files (CSS, JS, images, etc.) - AFTER auth routes
app.use(express.static(path.join(__dirname, 'src/views')));

// Design-system bundle (checklist-kitchen-ds) - static build output, no auth needed.
app.use('/design-system', express.static(path.join(__dirname, 'design-system/dist')));

const PORT = process.env.PORT || 3001;

app.listen(PORT,  () => {
  console.log(`Running on http://localhost:${PORT}`);
});