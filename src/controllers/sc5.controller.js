const e = require('express');
const fillSc5 = require('../lib/fillSc5');
const path = require('path');
const fs = require('fs');

exports.showForm = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc5.html'));
};

exports.processForm = async (req, res) => {
  try {
    // console.log('Received data:', req.body);

    // Load employee data from employees.json
    const employeesPath = path.join(__dirname, '../../records/employees.json');
    const employeesData = JSON.parse(fs.readFileSync(employeesPath, 'utf8'));
    
    // Find the employee by ID
    const employee = employeesData.find(emp => emp.id === parseInt(req.body.employee_id));
    
    // Add employee name and role/position to the data
    if (employee) {
      req.body.name = employee.name;
      req.body.position = employee.role;
    }

    const fileName = await fillSc5(req.body);

    res.json({
      success: true,
      file: fileName
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: JSON.stringify(err)
    });
  }

};