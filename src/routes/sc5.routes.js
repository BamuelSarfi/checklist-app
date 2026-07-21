const express = require('express');
const router = express.Router();
const controller = require('../controllers/sc5.controller');

router.get('/', controller.showForm);
router.post('/', controller.processForm);

module.exports = router;