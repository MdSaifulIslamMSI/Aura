describe('ops maintenance service', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            PAYMENTS_ENABLED: 'true',
            ORDER_EMAILS_ENABLED: 'true',
            CATALOG_IMPORTS_ENABLED: 'true',
            CATALOG_SYNC_ENABLED: 'true',
            COMMERCE_RECONCILIATION_ENABLED: 'true',
            ADMIN_ANALYTICS_MONITOR_ENABLED: 'true',
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('runs only requested maintenance tasks', async () => {
        const runOutboxCycle = jest.fn().mockResolvedValue(undefined);
        const getPaymentOutboxStats = jest.fn().mockResolvedValue({ status: 'healthy' });
        const runOrderEmailQueueCycle = jest.fn().mockResolvedValue(undefined);
        const getOrderEmailQueueStats = jest.fn().mockResolvedValue({ status: 'healthy' });
        const runCatalogImportWorkerCycle = jest.fn().mockResolvedValue(undefined);
        const runCatalogSyncWorkerCycle = jest.fn().mockResolvedValue(undefined);
        const getCatalogHealth = jest.fn().mockResolvedValue({ staleData: false });
        const runCommerceReconciliationCycle = jest.fn().mockResolvedValue(undefined);
        const getCommerceReconciliationStatus = jest.fn().mockResolvedValue({ status: 'healthy' });
        const runAdminAnalyticsMonitorCycle = jest.fn().mockResolvedValue(undefined);

        jest.doMock('../services/payments/paymentService', () => ({
            runOutboxCycle,
            getPaymentOutboxStats,
        }));
        jest.doMock('../services/email/orderEmailQueueService', () => ({
            runOrderEmailQueueCycle,
            getOrderEmailQueueStats,
        }));
        jest.doMock('../services/catalogService', () => ({
            runCatalogImportWorkerCycle,
            runCatalogSyncWorkerCycle,
            getCatalogHealth,
        }));
        jest.doMock('../services/commerceReconciliationService', () => ({
            runCommerceReconciliationCycle,
            getCommerceReconciliationStatus,
        }));
        jest.doMock('../services/adminAnalyticsMonitorService', () => ({
            runAdminAnalyticsMonitorCycle,
        }));

        const { runMaintenanceTasks } = require('../services/opsMaintenanceService');
        const result = await runMaintenanceTasks({
            requestedTasks: ['paymentOutbox', 'orderEmail'],
            source: 'test',
            requestId: 'req_test',
        });

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(2);
        expect(runOutboxCycle).toHaveBeenCalledTimes(1);
        expect(runOrderEmailQueueCycle).toHaveBeenCalledTimes(1);
        expect(runCatalogImportWorkerCycle).not.toHaveBeenCalled();
        expect(runCatalogSyncWorkerCycle).not.toHaveBeenCalled();
        expect(runCommerceReconciliationCycle).not.toHaveBeenCalled();
        expect(runAdminAnalyticsMonitorCycle).not.toHaveBeenCalled();
    });

    test('marks disabled tasks as disabled', async () => {
        process.env.ORDER_EMAILS_ENABLED = 'false';

        jest.doMock('../services/payments/paymentService', () => ({
            runOutboxCycle: jest.fn().mockResolvedValue(undefined),
            getPaymentOutboxStats: jest.fn().mockResolvedValue({ status: 'healthy' }),
        }));
        jest.doMock('../services/email/orderEmailQueueService', () => ({
            runOrderEmailQueueCycle: jest.fn().mockResolvedValue(undefined),
            getOrderEmailQueueStats: jest.fn().mockResolvedValue({ status: 'healthy' }),
        }));
        jest.doMock('../services/catalogService', () => ({
            runCatalogImportWorkerCycle: jest.fn().mockResolvedValue(undefined),
            runCatalogSyncWorkerCycle: jest.fn().mockResolvedValue(undefined),
            getCatalogHealth: jest.fn().mockResolvedValue({ staleData: false }),
        }));
        jest.doMock('../services/commerceReconciliationService', () => ({
            runCommerceReconciliationCycle: jest.fn().mockResolvedValue(undefined),
            getCommerceReconciliationStatus: jest.fn().mockResolvedValue({ status: 'healthy' }),
        }));
        jest.doMock('../services/adminAnalyticsMonitorService', () => ({
            runAdminAnalyticsMonitorCycle: jest.fn().mockResolvedValue(undefined),
        }));

        const { runMaintenanceTasks } = require('../services/opsMaintenanceService');
        const result = await runMaintenanceTasks({
            requestedTasks: ['orderEmail'],
            source: 'test',
        });

        expect(result.success).toBe(true);
        expect(result.disabled).toBe(1);
        expect(result.results[0]).toMatchObject({
            task: 'orderEmail',
            status: 'disabled',
        });
    });
});
