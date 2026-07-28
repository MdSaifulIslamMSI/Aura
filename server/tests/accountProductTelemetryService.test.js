const { EventEmitter } = require('events');
const { registry } = require('../middleware/metrics');
const {
    ACCOUNT_OPERATION_METRIC_NAME,
    ACCOUNT_MIGRATION_PENDING_METRIC_NAME,
    CLIENT_DIAGNOSTIC_METRIC_NAME,
    PRODUCT_EVENT_METRIC_NAME,
    normalizeAccountProductEvent,
    observeAccountOperation,
    recordAccountMigrationState,
    recordClientDiagnostic,
    refreshAccountMigrationMetrics,
    validateAccountProductEvent,
} = require('../services/accountProductTelemetryService');

describe('accountProductTelemetryService', () => {
    test('normalizes a typed event without retaining transport or identity fields', () => {
        const normalized = normalizeAccountProductEvent({
            id: 'client-event-id',
            type: 'account.preference_changed',
            route: '/profile?ticket=private-reference',
            sessionId: 'raw-session-id',
            requestId: 'raw-request-id',
            context: {
                topic: 'marketing',
                channel: 'email',
                enabled: false,
            },
        });

        expect(normalized).toMatchObject({
            type: 'account.preference_changed',
            route: 'account_center',
            sessionId: '',
            requestId: '',
            eventId: '',
            clientIp: '',
            userAgent: '',
            context: {
                topic: 'marketing',
                channel: 'email',
                enabled: false,
            },
        });
        expect(JSON.stringify(normalized)).not.toContain('private-reference');
        expect(JSON.stringify(normalized)).not.toContain('raw-session-id');
        expect(JSON.stringify(normalized)).not.toContain('raw-request-id');
    });

    test('rejects unknown fields, identifiers, and untyped account events', () => {
        expect(validateAccountProductEvent({
            type: 'account.profile_updated',
            context: {
                changedFields: ['name'],
                email: 'person@example.com',
            },
        })).toMatchObject({ applicable: true, success: false });
        expect(validateAccountProductEvent({
            type: 'account.arbitrary_event',
            context: {},
        })).toMatchObject({ applicable: true, success: false });
    });

    test('accepts bounded Core Web Vital measurements', () => {
        expect(validateAccountProductEvent({
            type: 'account.web_vital',
            context: {
                metric: 'LCP',
                value: 2488.125,
                rating: 'good',
                navigationType: 'navigate',
            },
        })).toMatchObject({ applicable: true, success: true });
    });

    test('records bounded failure outcomes for Account operations', async () => {
        const response = new EventEmitter();
        response.statusCode = 503;
        const next = jest.fn();

        observeAccountOperation('session_revoke_one')({}, response, next);
        response.emit('finish');

        expect(next).toHaveBeenCalledTimes(1);
        const metric = registry.getSingleMetric(ACCOUNT_OPERATION_METRIC_NAME);
        const values = (await metric.get()).values;
        expect(values).toEqual(expect.arrayContaining([
            expect.objectContaining({
                labels: {
                    operation: 'session_revoke_one',
                    outcome: 'failed',
                },
            }),
        ]));
    });

    test('records bounded diagnostic and migration dimensions', async () => {
        recordClientDiagnostic({
            type: 'arbitrary.client.value',
            severity: 'critical',
        });
        recordAccountMigrationState({
            mode: 'apply',
            status: 'paused',
            pending: 42,
            modified: 100,
        });

        const diagnostics = (await registry.getSingleMetric(CLIENT_DIAGNOSTIC_METRIC_NAME).get()).values;
        expect(diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                labels: { type: 'other', severity: 'info' },
            }),
        ]));
        const pending = (await registry.getSingleMetric(ACCOUNT_MIGRATION_PENDING_METRIC_NAME).get()).values;
        expect(pending).toEqual(expect.arrayContaining([
            expect.objectContaining({
                labels: { mode: 'apply' },
                value: 42,
            }),
        ]));
    });

    test('registers Account Center metrics before the first event', async () => {
        const metrics = await registry.metrics();

        expect(metrics).toContain(`# HELP ${PRODUCT_EVENT_METRIC_NAME}`);
        expect(metrics).toContain(`# HELP ${ACCOUNT_OPERATION_METRIC_NAME}`);
        expect(metrics).toContain('# HELP aura_account_operation_duration_seconds');
        expect(metrics).toContain('# HELP aura_account_migration_runs_total');
    });

    test('hydrates migration metrics from durable run evidence', async () => {
        const refreshed = await refreshAccountMigrationMetrics({
            connected: true,
            loadSnapshot: jest.fn().mockResolvedValue([{
                counts: [{
                    _id: { mode: 'apply', status: 'completed' },
                    value: 3,
                }],
                latest: [{
                    _id: 'apply',
                    pending: 0,
                    modified: 19,
                }],
            }]),
        });
        const metrics = await registry.metrics();

        expect(refreshed).toBe(true);
        expect(metrics).toContain(
            'aura_account_migration_runs_total{mode="apply",status="completed"} 3'
        );
        expect(metrics).toContain('aura_account_migration_pending_documents{mode="apply"} 0');
        expect(metrics).toContain('aura_account_migration_modified_documents{mode="apply"} 19');
    });
});
