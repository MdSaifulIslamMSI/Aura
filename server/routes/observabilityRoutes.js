const express = require('express');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { protect, protectOptional, admin } = require('../middleware/authMiddleware');
const { getAuthenticatedRateLimitIdentity } = require('../utils/requestIdentity');
const {
    getClientDiagnostics,
    ingestClientDiagnostics,
} = require('../controllers/observabilityController');

const router = express.Router();
const diagnosticsIngestLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'client_diagnostics_ingest',
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 40,
    message: {
        status: 'error',
        message: 'Too many client diagnostics received. Please slow down.',
    },
    keyGenerator: (req) => getAuthenticatedRateLimitIdentity(req),
});

// Clients should be able to send diagnostics even if not fully authenticated (e.g. before login)
router.post('/client-diagnostics', protectOptional, diagnosticsIngestLimiter, ingestClientDiagnostics);
router.get('/client-diagnostics', protect, admin, getClientDiagnostics);

module.exports = router;
