const fs = require('fs');
const path = require('path');
const fillSc3Entry = require('../lib/fillSc3');


exports.submitForm = async (req, res) => {
  try {
    const { cooking, cooling, reheating, comments } = req.body;
    const { employeeId, employeeName } = req.cookies;
    const employee_id = parseInt(employeeId);

    if (!employee_id || !employeeName) {
      return res.json({
        success: false,
        message: 'Employee not authenticated'
      });
    }

    // Get today's date
    const today = new Date();
    const day = today.getDate();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const date = `${year}-${month}-${String(day).padStart(2, '0')}`;

    // Use shared file for all users
    const jsonFileName = `SC3-${year}-${month}.json`;
    const jsonPath = path.join(__dirname, '../../records', jsonFileName);

    let monthData = { month, year, entries: [] };
    
    // Load existing month data if it exists
    if (fs.existsSync(jsonPath)) {
      try {
        monthData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (err) {
        console.warn('Could not read existing JSON file, starting fresh:', err);
      }
    }

    // Find or create entry for this employee and day
    let entryIndex = monthData.entries.findIndex(e => 
      e.employee_id === employee_id && e.day === day
    );

    const newEntry = {
      employee_id,
      employee_name: employeeName,
      day,
      date,
      cooking: cooking || [],
      cooling: cooling || [],
      reheating: reheating || [],
      comments: comments || '',
      signature: employeeName.charAt(0).toUpperCase(),
      timestamp: new Date().toISOString()
    };

    if (entryIndex >= 0) {
      monthData.entries[entryIndex] = newEntry;
    } else {
      monthData.entries.push(newEntry);
    }

    // Save to JSON file
    fs.writeFileSync(jsonPath, JSON.stringify(monthData, null, 2));

    // Check if total rows = 17, if so generate PDF
    const totalRows = (cooking?.length || 0) + (cooling?.length || 0) + (reheating?.length || 0);
    if (totalRows === 17) {
      try {
        const pdfPath = await fillSc3(newEntry, month, year);
        return res.json({
          success: true,
          message: 'SC3 form submitted and PDF generated successfully',
          pdfPath: pdfPath
        });
      } catch (err) {
        console.error('Error generating PDF:', err);
        // Don't fail the submission if PDF generation fails
      }
    }

    res.json({
      success: true,
      message: 'SC3 form submitted successfully'
    });
  } catch (err) {
    console.error('Error submitting form:', err);
    res.json({
      success: false,
      message: 'Error submitting form: ' + err.message
    });
  }
};

exports.getTodayData = (req, res) => {
  try {
    const { employeeId } = req.cookies;
    const employee_id = parseInt(employeeId);

    if (!employee_id) {
      return res.json({
        success: false,
        message: 'Employee not authenticated'
      });
    }

    const today = new Date();
    const day = today.getDate();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();

    const jsonPath = path.join(__dirname, '../../records', `SC3-${year}-${month}.json`);

    let data = null;

    if (fs.existsSync(jsonPath)) {
      try {
        const monthData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const entry = monthData.entries.find(e => 
          e.employee_id === employee_id && e.day === day
        );
        if (entry) {
          data = {
            cooking: entry.cooking || [],
            cooling: entry.cooling || [],
            reheating: entry.reheating || [],
            comments: entry.comments || ''
          };
        }
      } catch (err) {
        console.warn('Could not read JSON file:', err);
      }
    }

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Error getting today data:', err);
    res.json({
      success: false,
      message: 'Error getting data: ' + err.message
    });
  }
};

function buildSc3Payload(body = {}, employee = {}) {
    const cooking = Array.isArray(body.cooking) ? body.cooking : [];
    const cooling = Array.isArray(body.cooling) ? body.cooling : [];
    const reheating = Array.isArray(body.reheating) ? body.reheating : [];

    const rowCount = Math.max(cooking.length, cooling.length, reheating.length, 0);

    const rows = [];
    for (let i = 0; i < rowCount; i++) {
        const c = cooking[i] || {};
        const co = cooling[i] || {};
        const r = reheating[i] || {};

        rows.push({
            date: c.date || co.date || r.date || '',
            food: c.food || '',
            time_started_cooking: c.time_start || '',
            time_finished_cooking: c.time_end || '',
            core_temp: c.temp ?? '',
            cooking_sign: c.sign || employee.initial || employee.name || '',

            cooling_date: co.date || '',
            time_into_fridge: co.time || '',
            cooling_sign: co.sign || employee.initial || employee.name || '',

            reheating_date: r.date || '',
            reheating_core_temp: r.temp ?? '',
            reheating_sign: r.sign || employee.initial || employee.name || '',

            comment: i === 0 ? (body.comments || '') : ''
        });
    }

    return {
        employee_name: employee.name || employee.full_name || 'Employee',
        rows
    };
}

exports.submitAndExport = async (req, res) => {
    try {
        const employee = req.employee || req.session?.employee;
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const payload = buildSc3Payload(req.body || {}, employee);
        const fileName = await fillSc3Entry(payload);

        return res.json({
            success: true,
            fileName,
            pdfUrl: `/records/${fileName}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
