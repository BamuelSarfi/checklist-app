const express = require('express');
const router = express.Router();
const controller = require('../controllers/sc4.controller');
const path = require('path');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc4.html'));
});

router.post('/submit', controller.submitForm);
router.get('/today', controller.getTodayData);

module.exports = router;
