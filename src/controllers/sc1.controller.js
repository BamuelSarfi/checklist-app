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
    const { employee_id, employee_name, records } = req.body;

    // Validate input
    if (!employee_id || !records || !Array.isArray(records)) {
      return res.json({
        success: false,
        message: 'Invalid form data'
      });
    }

    // Load employee data from employees.json
    const employeesPath = path.join(__dirname, '../../records/employees.json');
    const employeesData = JSON.parse(fs.readFileSync(employeesPath, 'utf8'));

    // Find the employee by ID
    const employee = employeesData.find(emp => emp.id === parseInt(employee_id));

    // Add employee position/role to the data
    if (employee) {
      req.body.position = employee.role;
    }

    const fileName = await fillSc1(req.body);

    res.json({
      success: true,
      message: 'Form saved successfully',
      filename: fileName
    });

  } catch (err) {
    console.error('Error saving SC1 form:', err);
    res.json({
      success: false,
      message: 'Error saving form: ' + err.message
    });
  }
};
