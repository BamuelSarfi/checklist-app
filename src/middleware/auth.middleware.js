const fs = require('fs');
const path = require('path');
const { getEmployeeById } = require('../services/employeeDirectory');

// Load employees from JSON file
// Authentication middleware
const authenticateEmployee = async (req, res, next) => {
  // signedCookies, not cookies - an unsigned employeeId cookie (e.g. hand-crafted via
  // devtools or a MITM on plain HTTP) must not be trusted just because it names a real
  // employee id; only a cookie this server actually issued at /login should authenticate.
  const employeeId = req.signedCookies.employeeId;
  const sessionToken = req.signedCookies.sessionToken;

  // Both cookies must be present - this previously only redirected when BOTH were missing
  // (&&), so a request carrying just one of the two still fell through to getEmployeeById.
  if (!employeeId || !sessionToken) {
    return res.redirect('/login');
  }

  try {
    const employee = await getEmployeeById(employeeId);

    if (!employee) {
      // Employee not found in database, clear cookies and redirect
      res.clearCookie('employeeId');
      res.clearCookie('sessionToken');
      res.clearCookie('employeeName');
      return res.redirect('/login');
    }

    // Attach employee ID and data to request for use in routes
    req.employeeId = employeeId;
    req.employee = employee;
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    // On error, clear cookies and redirect to login
    res.clearCookie('employeeId');
    res.clearCookie('sessionToken');
    res.clearCookie('employeeName');
    return res.redirect('/login');
  }
};

module.exports = authenticateEmployee;

