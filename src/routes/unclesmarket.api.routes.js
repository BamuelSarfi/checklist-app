const express = require('express');
const router = express.Router();
const controller = require('../controllers/unclesmarket.controller');
const auth = require('../middleware/auth.middleware');

const ensureAuthenticated =
    typeof auth === 'function'
        ? auth
        : typeof auth?.ensureAuthenticated === 'function'
            ? auth.ensureAuthenticated
            : null;

router.get('/sections', ensureAuthenticated, controller.getSectionOptions);
router.get('/today', ensureAuthenticated, controller.getTodayData);
router.get('/progress', ensureAuthenticated, controller.getProgress);
router.get('/overview', ensureAuthenticated, controller.getOverview);
router.post('/draft', ensureAuthenticated, express.json(), controller.saveDraft);
router.post('/export', ensureAuthenticated, express.json(), controller.exportPdf);

module.exports = router;
