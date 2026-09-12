const express = require('express');
const router = express.Router();
const testerPromotion = require('../controllers/testerPromotion.controller');
const auth = require('../middleware/auth.middleware');

const ensureAuthenticated =
    typeof auth === 'function'
        ? auth
        : typeof auth?.ensureAuthenticated === 'function'
            ? auth.ensureAuthenticated
            : null;

if (typeof ensureAuthenticated !== 'function') {
    throw new Error('Tester Promotion auth middleware is not a function');
}

router.get('/', ensureAuthenticated, testerPromotion.showForm);
router.get('/status', ensureAuthenticated, testerPromotion.getStatus);
router.get('/till-qr', ensureAuthenticated, testerPromotion.getTillQr);
router.post('/start', ensureAuthenticated, express.json(), testerPromotion.startRun);
router.post('/end', ensureAuthenticated, express.json(), testerPromotion.endRun);

module.exports = router;
