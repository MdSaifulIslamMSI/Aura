const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getClientDiagnostics,
    ingestClientDiagnostics,
} = require('../controllers/observabilityController');

const router = express.Router();

router.post('/client-diagnostics', ingestClientDiagnostics);
router.get('/client-diagnostics', protect, admin, getClientDiagnostics);

module.exports = router;
