const e = require('express');
const fillSc1 = require('../lib/fillSc1');
const path = require('path');
const fs = require('fs');

exports.showForm = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc1.html'));
};

// Handle SC1 form submission
exports.submitForm = async (req, res) => {
  try {
    const { records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.json({
        success: false,
        message: 'Invalid form data'
      });
    }

    // Identity comes from the authenticated session (set by auth.middleware.js), never from
    // the request body - previously employee_id/employee_name were taken directly from
    // req.body with no cross-check, so any authenticated kiosk session could submit a form
    // attributed to a completely different (or entirely fabricated, non-existent) employee.
    const employee = req.employee;
    if (!employee) {
      return res.status(401).json({ success: false, message: 'Employee not identified' });
    }

    req.body.employee_id = employee.id;
    req.body.employee_name = employee.name;
    req.body.position = employee.role || employee.preferred_language || 'Employee';

    const { fileName, syncStatus, syncMessage } = await fillSc1(req.body);

    res.json({
      success: true,
      message: 'Form saved successfully',
      filename: fileName,
      // Non-blocking: the form above already saved successfully. This just tells the
      // manager the record hasn't synced to SafeCater yet (e.g. inactive subscription).
      sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
    });

  } catch (err) {
    console.error('Error saving SC1 form:', err);
    res.json({
      success: false,
      message: 'Error saving form: ' + err.message
    });
  }
};
