const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { csrfTokenValidatorUnlessBearerAuth } = require('../middleware/csrfMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireFreshMfa } = require('../middleware/requireFreshMfa');
const {
    getAccountSessions,
    getAccountSecurityActivity,
    revokeAccountSession,
    revokeAllAccountSessions,
    revokeOtherAccountSessions,
} = require('../controllers/accountSecurityController');
const {
    getAccountSessionsSchema,
    getAccountSecurityActivitySchema,
    revokeAccountSessionSchema,
    revokeAllAccountSessionsSchema,
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
const {
    createAvatarUploadIntent,
    finalizeAvatarMedia,
    uploadAvatarMedia,
} = require('../controllers/accountAvatarController');
const {
    createAvatarUploadIntentSchema,
    finalizeAvatarMediaSchema,
    uploadAvatarMediaSchema,
} = require('../validators/accountAvatarValidators');
const { getAccountMarketplace } = require('../controllers/accountMarketplaceController');
const {
    cancelDeactivationRequest,
    cancelDeletionRequest,
    getPrivacyCapabilities,
    getPrivacyRequest,
    requestAccountDeactivation,
    requestAccountDeletion,
    requestAccountExport,
} = require('../controllers/accountPrivacyController');
const {
    privacyRequestIdSchema,
    requestDeactivationSchema,
    requestDeletionSchema,
    requestExportSchema,
} = require('../validators/accountPrivacyValidators');
const { requireAccountPrivacyLifecycle } = require('../middleware/accountPrivacyPolicy');
const { observeAccountOperation } = require('../services/accountProductTelemetryService');

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
const accountAvatarLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'account_avatar_media',
    windowMs: 10 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 20,
    message: 'Too many avatar upload requests. Please try again shortly.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});
const accountMarketplaceLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'account_marketplace_hub',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many marketplace account requests. Please try again shortly.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});
const accountPrivacyLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'account_privacy_lifecycle',
    windowMs: 60 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 12,
    message: 'Too many account privacy requests. Please try again later.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});

router.use(protect);

router.get('/summary', accountMarketplaceLimiter, getAccountOverview);
router.get('/marketplace', accountMarketplaceLimiter, getAccountMarketplace);
router.get('/privacy/capabilities', accountPrivacyLimiter, getPrivacyCapabilities);
router.post(
    '/privacy/exports',
    observeAccountOperation('privacy_export'),
    accountPrivacyLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    requireAccountPrivacyLifecycle,
    requireFreshMfa({
        action: 'account.privacy.export',
        category: 'account_privacy',
    }),
    validate(requestExportSchema),
    requestAccountExport
);
router.get(
    '/privacy/requests/:requestId',
    accountPrivacyLimiter,
    requireAccountPrivacyLifecycle,
    validate(privacyRequestIdSchema),
    getPrivacyRequest
);
router.post(
    '/privacy/deactivation',
    observeAccountOperation('privacy_deactivation'),
    accountPrivacyLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    requireAccountPrivacyLifecycle,
    requireFreshMfa({
        action: 'account.privacy.deactivation',
        category: 'account_privacy',
    }),
    validate(requestDeactivationSchema),
    requestAccountDeactivation
);
router.delete(
    '/privacy/deactivation/:requestId',
    observeAccountOperation('privacy_deactivation_cancel'),
    accountPrivacyLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    requireAccountPrivacyLifecycle,
    requireFreshMfa({
        action: 'account.privacy.deactivation.cancel',
        category: 'account_privacy',
    }),
    validate(privacyRequestIdSchema),
    cancelDeactivationRequest
);
router.post(
    '/privacy/deletion-requests',
    observeAccountOperation('privacy_deletion'),
    accountPrivacyLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    requireAccountPrivacyLifecycle,
    requireFreshMfa({
        action: 'account.privacy.deletion',
        category: 'account_privacy',
    }),
    validate(requestDeletionSchema),
    requestAccountDeletion
);
router.delete(
    '/privacy/deletion-requests/:requestId',
    observeAccountOperation('privacy_deletion_cancel'),
    accountPrivacyLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    requireAccountPrivacyLifecycle,
    requireFreshMfa({
        action: 'account.privacy.deletion.cancel',
        category: 'account_privacy',
    }),
    validate(privacyRequestIdSchema),
    cancelDeletionRequest
);
router.get(
    '/preferences',
    accountPreferenceLimiter,
    validate(getAccountPreferencesSchema),
    getAccountPreferences
);
router.patch(
    '/preferences',
    observeAccountOperation('preference_update'),
    accountPreferenceLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    validate(updateAccountPreferencesSchema),
    updateAccountPreferences
);
router.post(
    '/avatar/upload-intents',
    observeAccountOperation('avatar_intent'),
    accountAvatarLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    validate(createAvatarUploadIntentSchema),
    createAvatarUploadIntent
);
router.post(
    '/avatar/uploads',
    observeAccountOperation('avatar_upload'),
    accountAvatarLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    validate(uploadAvatarMediaSchema),
    uploadAvatarMedia
);
router.post(
    '/avatar/finalize',
    observeAccountOperation('avatar_finalize'),
    accountAvatarLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    validate(finalizeAvatarMediaSchema),
    finalizeAvatarMedia
);
router.use('/sessions', accountSessionLimiter);
router.get('/sessions', validate(getAccountSessionsSchema), getAccountSessions);
router.get(
    '/security-activity',
    accountSessionLimiter,
    validate(getAccountSecurityActivitySchema),
    getAccountSecurityActivity
);
router.post(
    '/sessions/revoke-all',
    observeAccountOperation('session_revoke_all'),
    csrfTokenValidatorUnlessBearerAuth,
    requireFreshMfa({
        action: 'auth.sessions.revoke_all',
        category: 'account_security',
    }),
    validate(revokeAllAccountSessionsSchema),
    revokeAllAccountSessions
);
router.post(
    '/sessions/revoke-others',
    observeAccountOperation('session_revoke_others'),
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
    observeAccountOperation('session_revoke_one'),
    csrfTokenValidatorUnlessBearerAuth,
    validate(revokeAccountSessionSchema),
    revokeAccountSession
);

module.exports = router;
