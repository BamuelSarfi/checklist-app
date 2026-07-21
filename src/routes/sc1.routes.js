const express = require('express');
const router = express.Router();
const controller = require('../controllers/sc1.controller');

router.get('/', controller.showForm);
router.post('/', controller.submitForm);

module.exports = router;