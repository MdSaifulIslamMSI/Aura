const asyncHandler = require('express-async-handler');
const { runMaintenanceTasks } = require('../services/opsMaintenanceService');

const runInternalMaintenance = (taskName) => asyncHandler(async (req, res) => {
    const maintenance = await runMaintenanceTasks({
        requestedTasks: [taskName],
        source: 'vercel_cron',
        requestId: req.requestId || '',
    });

    res.status(maintenance.success ? 200 : 500).json({
        success: maintenance.success,
        maintenance,
    });
});

module.exports = {
    runPaymentOutboxMaintenance: runInternalMaintenance('paymentOutbox'),
    runOrderEmailMaintenance: runInternalMaintenance('orderEmail'),
    runCatalogImportMaintenance: runInternalMaintenance('catalogImport'),
    runCatalogSyncMaintenance: runInternalMaintenance('catalogSync'),
    runAdminAnalyticsMaintenance: runInternalMaintenance('adminAnalytics'),
    runDailyMaintenance: runInternalMaintenance('all'),
};
