const fs = require('fs');
const path = require('path');

// Load employees from JSON file
const loadEmployees = () => {
  const employeesPath = path.join(__dirname, '../../records/employees.json');
  const data = fs.readFileSync(employeesPath, 'utf8');
  return JSON.parse(data);
};

// Authentication middleware
const authenticateEmployee = (req, res, next) => {
  const employeeId = req.cookies.employeeId;
  const sessionToken = req.cookies.sessionToken;

  // Check if cookies exist
  if (!employeeId && !sessionToken) {
    return res.redirect('/login');
  }

  try {
    // Verify that the employee still exists in the database
    const employees = loadEmployees();
    const employee = employees.find(emp => emp.id === parseInt(employeeId));

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

