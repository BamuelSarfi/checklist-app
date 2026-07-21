const express = require('express');
const path = require('path');
const router = express.Router();
const controller = require('../controllers/sc3.controller');
const auth = require('../middleware/auth.middleware');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc3.html'));
});

router.post('/export', auth, express.json(), controller.submitAndExport);

module.exports = router;
