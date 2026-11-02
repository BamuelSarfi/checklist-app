const { getEmployeeById } = require('../services/employeeDirectory');
const { isSessionValid } = require('../services/sessions');

function clearSessionCookies(res) {
  res.clearCookie('employeeId');
  res.clearCookie('sessionToken');
  res.clearCookie('employeeName');
}

// Pages redirect to login. API calls and form submissions get a real 401 instead: a redirect would
// be followed by fetch, come back as a 200 login page, and look like a successful save to the
// offline queue, which would then throw the record away.
function rejectUnauthenticated(req, res) {
  if (req.method !== 'GET' || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ success: false, session_expired: true, message: 'Your session has ended. Please sign in again.' });
  }
  return res.redirect('/login');
}

const authenticateEmployee = async (req, res, next) => {
  // signedCookies, not cookies - an unsigned employeeId cookie (e.g. hand-crafted via
  // devtools or a MITM on plain HTTP) must not be trusted just because it names a real
  // employee id; only a cookie this server actually issued at /login should authenticate.
  const employeeId = req.signedCookies.employeeId;
  const sessionToken = req.signedCookies.sessionToken;

  if (!employeeId || !sessionToken) {
    return rejectUnauthenticated(req, res);
  }

  try {
    // Checked against the server-side session, so logging out and idling out really end it.
    if (!(await isSessionValid(sessionToken, employeeId))) {
      clearSessionCookies(res);
      return rejectUnauthenticated(req, res);
    }

    const employee = await getEmployeeById(employeeId);

    if (!employee) {
      clearSessionCookies(res);
      return rejectUnauthenticated(req, res);
    }

    req.employeeId = employeeId;
    req.employee = employee;
    return next();
  } catch (err) {
    console.error('Authentication error:', err);
    clearSessionCookies(res);
    return rejectUnauthenticated(req, res);
  }
};

// Staff can record and read, but only a manager can remove a compliance record. Role is set by the
// owner on the portal, so staff can't grant it to themselves.
function isManager(employee) {
  return /\bmanager\b/i.test(String(employee?.role || ''));
}

const requireManager = (req, res, next) => {
  if (!isManager(req.employee)) {
    return res.status(403).json({ success: false, message: 'Only a manager can do this.' });
  }
  return next();
};

module.exports = authenticateEmployee;
module.exports.requireManager = requireManager;
module.exports.isManager = isManager;
