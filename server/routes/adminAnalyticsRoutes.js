const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    getAdminAnalyticsOverview,
    getAdminAnalyticsTimeSeries,
    getAdminAnalyticsAnomalies,
    exportAdminAnalyticsCsv,
    getAdminBiConfig,
} = require('../controllers/adminAnalyticsController');
const {
    adminAnalyticsOverviewSchema,
    adminAnalyticsTimeSeriesSchema,
    adminAnalyticsAnomalySchema,
    adminAnalyticsExportSchema,
} = require('../validators/adminAnalyticsValidators');

router.get('/overview', protect, admin, validate(adminAnalyticsOverviewSchema), getAdminAnalyticsOverview);
router.get('/timeseries', protect, admin, validate(adminAnalyticsTimeSeriesSchema), getAdminAnalyticsTimeSeries);
router.get('/anomalies', protect, admin, validate(adminAnalyticsAnomalySchema), getAdminAnalyticsAnomalies);
router.get('/export', protect, admin, validate(adminAnalyticsExportSchema), exportAdminAnalyticsCsv);
router.get('/bi-config', protect, admin, getAdminBiConfig);

module.exports = router;
