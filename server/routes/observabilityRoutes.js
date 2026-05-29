const express = require('express');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { protect, admin } = require('../middleware/authMiddleware');
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

// Clients should be able to send diagnostics even if auth state is missing or expired.
router.post('/client-diagnostics', diagnosticsIngestLimiter, ingestClientDiagnostics);
router.get('/client-diagnostics', protect, admin, getClientDiagnostics);

module.exports = router;
