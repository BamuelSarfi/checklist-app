const express = require('express');
const sc5Routes = require('./src/routes/sc5.routes');
const sc3Routes = require('./src/routes/sc3.routes');
const sc2Routes = require('./src/routes/sc2.routes');
const sc1Routes = require('./src/routes/sc1.routes');
const cookieParser = require('cookie-parser');
const authenticateEmployee = require('./src/middleware/auth.middleware');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
//use .env file for environment variables
require('dotenv').config();

const app = express();
const path = require('path');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/login', loginLimiter);
app.use('/api/auth', loginLimiter);

// Load employees from JSON file
const loadEmployees = () => {
  const employeesPath = path.join(__dirname, 'records/employees.json');
  const data = fs.readFileSync(employeesPath, 'utf8');
  return JSON.parse(data);
};

// LOGIN ROUTE (unprotected)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/login.html'));
});

app.post('/login', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ success: false, message: 'PIN required' });
  }

  try {
    const employees = loadEmployees();
    const employee = employees.find(emp => emp.pin === pin);

    if (!employee) {
      return res.status(401).json({ success: false, message: 'Invalid PIN' });
    }

    // Generate a simple session token
    const sessionToken = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

    // Set cookies (expires in 24 hours)
    res.cookie('employeeId', employee.id, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      secure: false // Set to true if using HTTPS
    });

    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      secure: false
    });

    res.cookie('employeeName', employee.name, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: 'Login successful',
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
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
  res.redirect('/login');
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
        email: req.employee.email,
        location: req.employee.location
      }
    });
  } catch (err) {
    console.error('Error fetching employee:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET COMPLETED CHECKLISTS FOR TODAY (protected route)
app.get('/api/completed-checklists', authenticateEmployee, (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const todayFormatted = today.replace(/\//g, '-'); // DD-MM-YYYY
    
    const recordsPath = path.join(__dirname, 'records');
    const files = fs.readdirSync(recordsPath);
    
    // Check which checklists are completed today
    const completed = {
      sc5: files.some(file => file.startsWith(`SC5-${todayFormatted}`)),
      sc4: files.some(file => file.startsWith(`SC4-${todayFormatted}`)),
      sc3: files.some(file => file.startsWith(`SC3-${todayFormatted}`)),
      sc2: files.some(file => file.startsWith(`SC2-${todayFormatted}`)),
      sc1: files.some(file => file.startsWith(`SC1-${todayFormatted}`))
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

// GET ALL RECORDS (unprotected route)
app.get('/api/records', (req, res) => {
  try {
    const recordsPath = path.join(__dirname, 'records');
    const files = fs.readdirSync(recordsPath);
    
    // Filter only PDF files
    const pdfFiles = files.filter(file => file.endsWith('.pdf')).sort().reverse();
    
    res.json({
      success: true,
      records: pdfFiles
    });
  } catch (err) {
    console.error('Error fetching records:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.delete('/api/records/:fileName', authenticateEmployee, (req, res) => {
  try {
    const fileName = req.params.fileName;
    const recordPath = path.join(__dirname, 'records', fileName);
    
    // Security: prevent directory traversal
    if (!recordPath.startsWith(path.join(__dirname, 'records'))) {
      return res.status(403).json({ success: false, message: 'Invalid file path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(recordPath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Delete the file
    fs.unlinkSync(recordPath);
    
    res.json({
      success: true,
      message: 'Record deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// SC1 FORM SUBMISSION (protected route)
app.post('/api/sc1', authenticateEmployee, async (req, res) => {
  try {
    const { employee_id, employee_name, records } = req.body;

    // Validate input
    if (!employee_id || !records || !Array.isArray(records)) {
      return res.json({
        success: false,
        message: 'Invalid form data'
      });
    }

    // Create records directory if it doesn't exist
    const recordsDir = path.join(__dirname, 'records');
    if (!fs.existsSync(recordsDir)) {
      fs.mkdirSync(recordsDir, { recursive: true });
    }

    // Get current date for filename
    const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
    const sanitizedName = employee_name.replace(/[^a-zA-Z0-9]/g, '_');
    const baseFilename = `SC1-${today}-${sanitizedName}`;
    const jsonFilename = `${baseFilename}.json`;
    const pdfFilename = `${baseFilename}.pdf`;

    const jsonPath = path.join(recordsDir, jsonFilename);

    // Load existing records if they exist
    let existingRecords = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        existingRecords = existingData.records || [];
      } catch (err) {
        console.warn('Could not read existing JSON file, starting fresh:', err);
      }
    }

    // Merge new records with existing ones
    const mergedRecords = [...existingRecords];

    // Add new records, avoiding duplicates based on content
    for (const newRecord of records) {
      const exists = mergedRecords.some(existing =>
        existing.food_item === newRecord.food_item &&
        existing.supplied_by === newRecord.supplied_by &&
        existing.date === newRecord.date
      );

      if (!exists) {
        mergedRecords.push(newRecord);
      }
    }

    // Check if we exceed the maximum of 16 records
    if (mergedRecords.length > 16) {
      return res.json({
        success: false,
        message: `Cannot add records. Maximum limit of 16 records per day reached. Current count: ${existingRecords.length}, trying to add: ${records.length}`
      });
    }

    // Prepare the submission data
    const submission = {
      timestamp: new Date().toISOString(),
      employee_id: employee_id,
      employee_name: employee_name,
      records: mergedRecords
    };

    // Save JSON data
    fs.writeFileSync(jsonPath, JSON.stringify(submission, null, 2));

    // Import the fillSc1 function
    const fillSc1 = require('./src/lib/fillSc1');

    // Generate PDF (this will overwrite the existing PDF)
    const generatedFilename = await fillSc1(submission);

    res.json({
      success: true,
      message: existingRecords.length > 0 ?
        `Form updated successfully. Total records: ${mergedRecords.length}` :
        'Form saved successfully',
      filename: generatedFilename,
      totalRecords: mergedRecords.length
    });

  } catch (err) {
    console.error('Error saving SC1 form:', err);
    res.json({
      success: false,
      message: 'Error saving form: ' + err.message
    });
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
// app.post('/api/sc3/export', authenticateEmployee, sc3Controller.submitForm);
app.get('/api/sc3/today', authenticateEmployee, sc3Controller.getTodayData);

const sc4Controller = require('./src/controllers/sc4.controller');
app.post('/api/sc4/submit', authenticateEmployee, sc4Controller.submitForm);
app.post('/api/sc4/export', authenticateEmployee, sc4Controller.exportPdf);
app.get('/api/sc4/today', authenticateEmployee, sc4Controller.getTodayData);

// Protected routes
app.use('/sc5', authenticateEmployee, sc5Routes);
app.use('/sc4', authenticateEmployee, require('./src/routes/sc4.routes'));
app.use('/sc3', authenticateEmployee, sc3Routes);
app.use('/sc2', authenticateEmployee, sc2Routes);
app.use('/sc1', authenticateEmployee, sc1Routes);

// Library page (protected)
app.get('/library', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/library.html'));
});

// Home page (protected) - MUST be before static middleware
app.get('/', authenticateEmployee, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/index.html'));
});

// Handle JSON record files - return empty records if not found
app.get('/records/:filename', (req, res, next) => {


  if (!req.params.filename.endsWith('.json')) {
    return next();
  }
  const filePath = path.join(__dirname, 'records', req.params.filename);
  
  console.log(filePath);

  const fileName = path.basename(req.params.filename || '');
  if (fileName === 'employees.json') {
      return res.status(403).send('Forbidden');
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.json({ records: [] });
  }
});

// Serve records/PDFs (unprotected)
app.use('/records', (req, res, next) => {
    if (req.path === '/employees.json') {
        return res.status(403).send('Forbidden');
    }
    next();
}, express.static(path.join(__dirname, 'records')));

// Static files (CSS, JS, images, etc.) - AFTER auth routes
app.use(express.static(path.join(__dirname, 'src/views')));

const PORT = process.env.PORT || 3001;

app.listen(PORT,  () => {
  console.log(`Running on http://localhost:${PORT}`);
});