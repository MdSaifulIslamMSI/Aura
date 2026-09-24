const express = require('express');
const {
    createImportJob,
    getImportJobById,
    publishImportJob,
    createSyncRun,
    getCatalogOpsHealth,
    validateCatalogOnboarding,
    getSearchRelevanceReport,
} = require('../controllers/catalogAdminController');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const {
    createCatalogImportSchema,
    validateCatalogOnboardingSchema,
    getCatalogImportSchema,
    publishCatalogImportSchema,
    createCatalogSyncRunSchema,
} = require('../validators/catalogValidators');

const router = express.Router();

// CRITICAL: All catalog admin routes require authentication and validation
router.post('/onboarding/validate', protect, admin, validate(validateCatalogOnboardingSchema), requireTrustDecision('admin.catalog.write'), sensitiveActions.adminCatalogChange, validateCatalogOnboarding);
router.post('/imports', protect, admin, validate(createCatalogImportSchema), requireTrustDecision('admin.catalog.write'), sensitiveActions.adminCatalogChange, createImportJob);
router.get('/imports/:jobId', protect, admin, validate(getCatalogImportSchema), getImportJobById);
router.post('/imports/:jobId/publish', protect, admin, validate(publishCatalogImportSchema), requireTrustDecision('admin.catalog.write'), sensitiveActions.adminCatalogChange, publishImportJob);
router.post('/sync/run', protect, admin, validate(createCatalogSyncRunSchema), requireTrustDecision('admin.catalog.write'), sensitiveActions.adminCatalogChange, createSyncRun);
router.get('/health', protect, admin, getCatalogOpsHealth);
router.get('/search/relevance-report', protect, admin, getSearchRelevanceReport);

module.exports = router;
