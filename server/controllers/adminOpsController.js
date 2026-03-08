const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const AdminNotification = require('../models/AdminNotification');
const PaymentIntent = require('../models/PaymentIntent');
const {
    getPaymentOutboxStats,
} = require('../services/payments/paymentService');
const {
    getOrderEmailQueueStats,
} = require('../services/email/orderEmailQueueService');
const {
    getCatalogHealth,
} = require('../services/catalogService');
const {
    getCommerceReconciliationStatus,
} = require('../services/commerceReconciliationService');
const {
    listClientDiagnostics,
} = require('../services/clientDiagnosticIngestionService');
const { runMaintenanceTasks } = require('../services/opsMaintenanceService');

const isHealthyStatus = (value) => ['healthy', 'ok'].includes(String(value || '').trim().toLowerCase());

const buildReadiness = async () => {
    const dbConnected = mongoose.connection.readyState === 1;

    const [
        usersTotal,
        usersAdmins,
        usersSellers,
        productsTotal,
        ordersTotal,
        listingsTotal,
        unreadAdminNotifications,
        failedPayments,
        pendingPayments,
        paymentQueue,
        emailQueue,
        catalogHealth,
        reconciliation,
    ] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ isAdmin: true }),
        User.countDocuments({ isSeller: true }),
        Product.countDocuments({}),
        Order.countDocuments({}),
        Listing.countDocuments({}),
        AdminNotification.countDocuments({ isRead: false }),
        PaymentIntent.countDocuments({ status: 'failed' }),
        PaymentIntent.countDocuments({ status: { $in: ['created', 'challenge_pending'] } }),
        getPaymentOutboxStats().catch(() => ({ status: 'degraded' })),
        getOrderEmailQueueStats().catch(() => ({ status: 'degraded' })),
        getCatalogHealth().catch(() => ({ status: 'degraded', staleData: true })),
        getCommerceReconciliationStatus().catch(() => ({ status: 'degraded', unsafeMismatchCount: 1, staleLocks: 1 })),
    ]);

    const blockingIssues = [];
    const warnings = [];

    if (!dbConnected) blockingIssues.push('database_disconnected');
    if (!isHealthyStatus(paymentQueue?.status)) blockingIssues.push('payment_queue_unhealthy');
    if (!isHealthyStatus(emailQueue?.status)) blockingIssues.push('order_email_queue_unhealthy');
    if (Boolean(catalogHealth?.staleData)) blockingIssues.push('catalog_stale');
    if (!isHealthyStatus(reconciliation?.status)) blockingIssues.push('reconciliation_degraded');

    if (failedPayments > 100) warnings.push('high_failed_payments');
    if (pendingPayments > 1000) warnings.push('high_pending_payments');
    if (unreadAdminNotifications > 500) warnings.push('notification_backlog');
    if (Number(reconciliation?.staleLocks || 0) > 0) warnings.push('stale_worker_locks');

    const baseScore = 100;
    const scoreAfterBlocks = baseScore - (blockingIssues.length * 25);
    const scoreAfterWarnings = scoreAfterBlocks - (warnings.length * 5);
    const readinessScore = Math.max(0, Math.min(100, scoreAfterWarnings));

    const saturation = readinessScore === 100
        ? 'saturated'
        : (readinessScore >= 75 ? 'operational_with_risk' : 'degraded');

    return {
        readinessScore,
        saturation,
        checks: {
            dbConnected,
            paymentQueueStatus: paymentQueue?.status || 'unknown',
            emailQueueStatus: emailQueue?.status || 'unknown',
            catalogStale: Boolean(catalogHealth?.staleData),
            reconciliationStatus: reconciliation?.status || 'unknown',
        },
        modules: {
            userGovernance: {
                operational: dbConnected,
                signals: {
                    totalUsers: usersTotal,
                    totalAdmins: usersAdmins,
                    totalSellers: usersSellers,
                },
            },
            productControl: {
                operational: dbConnected && !Boolean(catalogHealth?.staleData),
                signals: {
                    totalProducts: productsTotal,
                    activeCatalogVersion: catalogHealth?.activeVersion || 'unknown',
                },
            },
            paymentOps: {
                operational: isHealthyStatus(paymentQueue?.status),
                signals: {
                    failedPayments,
                    pendingPayments,
                    queue: paymentQueue,
                    captureBacklog: Number(reconciliation?.paymentCaptureBacklog || 0),
                    refundBacklog: Number(reconciliation?.refundBacklog || 0),
                },
            },
            orderEmailOps: {
                operational: isHealthyStatus(emailQueue?.status),
                signals: {
                    queue: emailQueue,
                    backlog: Number(reconciliation?.orderEmailBacklog || 0),
                },
            },
            marketplaceOps: {
                operational: dbConnected,
                signals: {
                    totalListings: listingsTotal,
                    totalOrders: ordersTotal,
                    unreadAdminNotifications,
                },
            },
            commerceReconciliation: {
                operational: isHealthyStatus(reconciliation?.status),
                signals: {
                    unsafeMismatchCount: Number(reconciliation?.unsafeMismatchCount || 0),
                    staleLocks: Number(reconciliation?.staleLocks || 0),
                    replacementBacklog: Number(reconciliation?.replacementBacklog || 0),
                    lastRun: reconciliation?.lastRun || null,
                },
            },
        },
        blockingIssues,
        warnings,
        backlogs: {
            paymentCapture: Number(reconciliation?.paymentCaptureBacklog || 0),
            refunds: Number(reconciliation?.refundBacklog || 0),
            orderEmail: Number(reconciliation?.orderEmailBacklog || 0),
            replacements: Number(reconciliation?.replacementBacklog || 0),
            staleLocks: Number(reconciliation?.staleLocks || 0),
            catalogFreshnessSec: Number(catalogHealth?.lastSyncAgeSec ?? catalogHealth?.lastImportAgeSec ?? 0),
        },
        generatedAt: new Date().toISOString(),
    };
};

// @desc    Get admin operational readiness score + module health
// @route   GET /api/admin/ops/readiness
// @access  Private/Admin
const getAdminOpsReadiness = asyncHandler(async (req, res) => {
    const readiness = await buildReadiness();
    res.json({
        success: true,
        readiness,
    });
});

// @desc    Run admin control-plane smoke checks (read-only)
// @route   POST /api/admin/ops/smoke
// @access  Private/Admin
const runAdminOpsSmoke = asyncHandler(async (req, res) => {
    const readiness = await buildReadiness();
    const smoke = {
        passed: readiness.blockingIssues.length === 0,
        checks: [
            { key: 'db_connected', ok: readiness.checks.dbConnected },
            { key: 'payment_queue_healthy', ok: isHealthyStatus(readiness.checks.paymentQueueStatus) },
            { key: 'email_queue_healthy', ok: isHealthyStatus(readiness.checks.emailQueueStatus) },
            { key: 'catalog_not_stale', ok: !readiness.checks.catalogStale },
            { key: 'reconciliation_healthy', ok: isHealthyStatus(readiness.checks.reconciliationStatus) },
        ],
        blockingIssues: readiness.blockingIssues,
        warnings: readiness.warnings,
        readinessScore: readiness.readinessScore,
        generatedAt: new Date().toISOString(),
    };

    res.json({
        success: true,
        smoke,
    });
});

// @desc    Run short maintenance tasks on demand
// @route   POST /api/admin/ops/maintenance
// @access  Private/Admin
const runAdminOpsMaintenance = asyncHandler(async (req, res) => {
    const maintenance = await runMaintenanceTasks({
        requestedTasks: req.body?.tasks || [],
        source: 'admin_manual',
        requestId: req.requestId || '',
    });

    res.status(maintenance.success ? 200 : 500).json({
        success: maintenance.success,
        maintenance,
    });
});

// @desc    Query recent persisted client diagnostics
// @route   GET /api/admin/ops/client-diagnostics
// @access  Private/Admin
const getAdminClientDiagnostics = asyncHandler(async (req, res) => {
    const result = await listClientDiagnostics({
        limit: req.query?.limit,
        type: req.query?.type,
        severity: req.query?.severity,
        sessionId: req.query?.sessionId,
        requestId: req.query?.requestId,
        route: req.query?.route,
    });

    res.json({
        success: true,
        source: result.source,
        count: result.diagnostics.length,
        diagnostics: result.diagnostics,
    });
});

module.exports = {
    getAdminClientDiagnostics,
    getAdminOpsReadiness,
    runAdminOpsSmoke,
    runAdminOpsMaintenance,
};
