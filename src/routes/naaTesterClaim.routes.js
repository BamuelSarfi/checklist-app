const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const controller = require('../controllers/naaTesterClaim.controller');

const limited = (windowMinutes, max, keyGenerator) => rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Each registration can send a paid WhatsApp message, so there's a cap per address and a cap overall
// that holds even if someone rotates addresses. Generous per address because customers in the shop
// may share its Wi-Fi.
const registerPerAddress = limited(15, 20);
const registerOverall = limited(15, 100, () => 'all-registrations');
const claimPerAddress = limited(15, 30);

// Deliberately unauthenticated (see server.js) - a customer on their own phone has no
// employee PIN session, and shouldn't need one.
router.get('/', controller.showApp);
router.post('/register', registerPerAddress, registerOverall, express.json({ limit: '10kb' }), controller.register);
router.get('/verify-status/:id', controller.getVerifyStatus);
router.post('/claim', claimPerAddress, express.json({ limit: '10kb' }), controller.claim);

module.exports = router;
