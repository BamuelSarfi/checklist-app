const express = require('express');
const router = express.Router();
const unclesMarket = require('../controllers/unclesmarket.controller');
const auth = require('../middleware/auth.middleware');

const ensureAuthenticated =
    typeof auth === 'function'
        ? auth
        : typeof auth?.ensureAuthenticated === 'function'
            ? auth.ensureAuthenticated
            : null;

if (typeof ensureAuthenticated !== 'function') {
    throw new Error('UnclesMarket auth middleware is not a function');
}

const safeHandler = (fn, message) => {
    if (typeof fn === 'function') return fn;
    return (req, res) => res.status(500).json({ success: false, message });
};

router.get('/', ensureAuthenticated, safeHandler(unclesMarket.showSelection, 'UnclesMarket showSelection is missing'));
router.get('/checklist', ensureAuthenticated, safeHandler(unclesMarket.showForm, 'UnclesMarket showForm is missing'));

module.exports = router;
