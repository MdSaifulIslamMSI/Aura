const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getClientDiagnostics,
    ingestClientDiagnostics,
} = require('../controllers/observabilityController');

const router = express.Router();

// CRITICAL: Ingest endpoint REQUIRES authentication - this is sensitive data ingestion
router.post('/client-diagnostics', protect, admin, ingestClientDiagnostics);
router.get('/client-diagnostics', protect, admin, getClientDiagnostics);

module.exports = router;
