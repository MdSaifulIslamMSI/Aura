const express = require('express');
const { protect, protectOptional, admin } = require('../middleware/authMiddleware');
const {
    getClientDiagnostics,
    ingestClientDiagnostics,
} = require('../controllers/observabilityController');

const router = express.Router();

// Clients should be able to send diagnostics even if not fully authenticated (e.g. before login)
router.post('/client-diagnostics', protectOptional, ingestClientDiagnostics);
router.get('/client-diagnostics', protect, admin, getClientDiagnostics);

module.exports = router;
