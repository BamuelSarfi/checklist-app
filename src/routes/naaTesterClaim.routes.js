const express = require('express');
const router = express.Router();
const controller = require('../controllers/naaTesterClaim.controller');

// Deliberately unauthenticated (see server.js) - a customer on their own phone has no
// employee PIN session, and shouldn't need one.
router.get('/', controller.showApp);
router.post('/register', express.json(), controller.register);
router.get('/verify-status/:id', controller.getVerifyStatus);
router.post('/claim', express.json(), controller.claim);

module.exports = router;
