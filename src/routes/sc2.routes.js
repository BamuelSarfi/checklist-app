const express = require('express');
const router = express.Router();
const sc2 = require('../controllers/sc2.controller');
const auth = require('../middleware/auth.middleware');

const ensureAuthenticated =
    typeof auth === 'function'
        ? auth
        : typeof auth?.ensureAuthenticated === 'function'
            ? auth.ensureAuthenticated
            : null;

if (typeof ensureAuthenticated !== 'function') {
    throw new Error('SC2 auth middleware is not a function');
}

const safeHandler = (fn, message) => {
    if (typeof fn === 'function') return fn;
    return (req, res) => res.status(500).json({ success: false, message });
};

router.get('/', ensureAuthenticated, safeHandler(sc2.showForm, 'SC2 showForm is missing'));
router.get('/today', ensureAuthenticated, safeHandler(sc2.getTodayData, 'SC2 getTodayData is missing'));
router.get('/progress', ensureAuthenticated, safeHandler(sc2.getProgress, 'SC2 getProgress is missing'));
router.post('/draft', ensureAuthenticated, express.json(), safeHandler(sc2.saveDraft, 'SC2 saveDraft is missing'));
router.post('/export', ensureAuthenticated, express.json(), safeHandler(sc2.exportPdf, 'SC2 exportPdf is missing'));
router.post('/reopen', ensureAuthenticated, express.json(), safeHandler(sc2.reopenForEditing, 'SC2 reopenForEditing is missing'));

module.exports = router;

