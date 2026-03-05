const express = require('express');
const {
    createImportJob,
    getImportJobById,
    publishImportJob,
    createSyncRun,
    getCatalogOpsHealth,
} = require('../controllers/catalogAdminController');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createCatalogImportSchema,
    getCatalogImportSchema,
    publishCatalogImportSchema,
    createCatalogSyncRunSchema,
} = require('../validators/catalogValidators');

const router = express.Router();

router.post('/imports', protect, admin, validate(createCatalogImportSchema), createImportJob);
router.get('/imports/:jobId', protect, admin, validate(getCatalogImportSchema), getImportJobById);
router.post('/imports/:jobId/publish', protect, admin, validate(publishCatalogImportSchema), publishImportJob);
router.post('/sync/run', protect, admin, validate(createCatalogSyncRunSchema), createSyncRun);
router.get('/health', protect, admin, getCatalogOpsHealth);

module.exports = router;
