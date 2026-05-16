const express = require('express');
const { getEmergencyStatus } = require('../controllers/emergencyControlController');

const router = express.Router();

router.get('/status', getEmergencyStatus);

module.exports = router;
