const path = require('path');
const fillSc7 = require('../lib/fillSc7');

exports.showForm = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc7.html'));
};

exports.processForm = async (req, res) => {
  try {
    // Identity comes from the authenticated session, never from the request body - see
    // sc1.controller.js for the failure this prevents (any authenticated kiosk session could
    // otherwise submit a form attributed to a different or entirely fabricated employee).
    const employee = req.employee;
    if (!employee) {
      return res.status(401).json({ success: false, message: 'Employee not identified' });
    }

    req.body.employee_id = employee.id;
    req.body.name = employee.name;

    const { fileName, syncStatus, syncMessage } = await fillSc7(req.body);

    res.json({
      success: true,
      file: fileName,
      sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: JSON.stringify(err),
    });
  }
};
