const express = require('express');
const controller = require('../controllers/sfbb.controller');

const router = express.Router();

router.get('/day', controller.getDay);
router.post('/day/complete', controller.completeSection);
router.post('/day/problem', controller.addProblem);
router.post('/day/extra-check', controller.addExtraCheck);
router.post('/day/prove-it', controller.addProveIt);
router.get('/review', controller.getReview);

module.exports = router;
