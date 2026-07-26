const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { csrfTokenValidatorUnlessBearerAuth } = require('../middleware/csrfMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireFreshMfa } = require('../middleware/requireFreshMfa');
const {
    getAccountSessions,
    revokeAccountSession,
    revokeOtherAccountSessions,
} = require('../controllers/accountSecurityController');
const {
    getAccountSessionsSchema,
    revokeAccountSessionSchema,
    revokeOtherAccountSessionsSchema,
} = require('../validators/accountSessionValidators');
const { getAccountOverview } = require('../controllers/accountController');
const {
    getAccountPreferences,
    updateAccountPreferences,
} = require('../controllers/accountPreferenceController');
const {
    getAccountPreferencesSchema,
    updateAccountPreferencesSchema,
} = require('../validators/accountPreferenceValidators');

const router = express.Router();

const accountSessionLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'account_session_management',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many account session requests. Please try again shortly.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});
const accountPreferenceLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'account_preferences',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 90,
    message: 'Too many account preference requests. Please try again shortly.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});

router.use(protect);

router.get('/summary', getAccountOverview);
router.get(
    '/preferences',
    accountPreferenceLimiter,
    validate(getAccountPreferencesSchema),
    getAccountPreferences
);
router.patch(
    '/preferences',
    accountPreferenceLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    validate(updateAccountPreferencesSchema),
    updateAccountPreferences
);
router.use('/sessions', accountSessionLimiter);
router.get('/sessions', validate(getAccountSessionsSchema), getAccountSessions);
router.post(
    '/sessions/revoke-others',
    csrfTokenValidatorUnlessBearerAuth,
    requireFreshMfa({
        action: 'auth.sessions.revoke_others',
        category: 'account_security',
    }),
    validate(revokeOtherAccountSessionsSchema),
    revokeOtherAccountSessions
);
router.delete(
    '/sessions/:sessionAlias',
    csrfTokenValidatorUnlessBearerAuth,
    validate(revokeAccountSessionSchema),
    revokeAccountSession
);

module.exports = router;
