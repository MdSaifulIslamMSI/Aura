const client = require('prom-client');
const mongoose = require('mongoose');
const { z } = require('zod');
const { registry } = require('../middleware/metrics');
const AccountCenterMigrationRun = require('../models/AccountCenterMigrationRun');
const logger = require('../utils/logger');

const ACCOUNT_PRODUCT_EVENT_TYPES = Object.freeze([
    'account.section_viewed',
    'account.profile_updated',
    'account.address_added',
    'account.preference_changed',
    'account.order_searched',
    'account.return_started',
    'account.buy_again_selected',
    'account.passkey_added',
    'account.session_revoked',
    'account.export_requested',
    'account.deactivation_initiated',
    'account.deletion_initiated',
    'account.web_vital',
]);
const ACCOUNT_PRODUCT_EVENT_TYPE_SET = new Set(ACCOUNT_PRODUCT_EVENT_TYPES);
const ACCOUNT_EVENT_PREFIX = 'account.';
const PRODUCT_EVENT_METRIC_NAME = 'aura_account_product_events_total';
const ACCOUNT_OPERATION_METRIC_NAME = 'aura_account_operations_total';
const ACCOUNT_OPERATION_DURATION_METRIC_NAME = 'aura_account_operation_duration_seconds';
const ACCOUNT_PRIVACY_JOB_METRIC_NAME = 'aura_account_privacy_job_transitions_total';
const ACCOUNT_MIGRATION_RUN_METRIC_NAME = 'aura_account_migration_runs_total';
const ACCOUNT_MIGRATION_PENDING_METRIC_NAME = 'aura_account_migration_pending_documents';
const ACCOUNT_MIGRATION_MODIFIED_METRIC_NAME = 'aura_account_migration_modified_documents';
const CLIENT_DIAGNOSTIC_METRIC_NAME = 'aura_client_diagnostics_total';

const accountSections = [
    'overview',
    'personal',
    'addresses',
    'orders',
    'rewards',
    'marketplace',
    'payments',
    'support',
    'notifications',
    'settings',
    'privacy',
];
const profileFields = ['name', 'phone', 'dob', 'gender', 'bio'];
const preferenceTopics = [
    'orderUpdates',
    'deliveryUpdates',
    'returnRefundUpdates',
    'marketplaceUpdates',
    'productAlerts',
    'marketing',
    'security',
];
const accountOperations = new Set([
    'avatar_finalize',
    'avatar_intent',
    'avatar_upload',
    'preference_update',
    'privacy_deactivation',
    'privacy_deactivation_cancel',
    'privacy_deletion',
    'privacy_deletion_cancel',
    'privacy_export',
    'session_revoke_all',
    'session_revoke_one',
    'session_revoke_others',
]);
const privacyJobTypes = new Set(['export', 'deactivation', 'deletion']);
const privacyJobStates = new Set([
    'awaiting_grace',
    'blocked',
    'cancelled',
    'completed',
    'failed',
    'processing',
    'queued',
    'ready',
]);
const clientDiagnosticTypes = new Set([
    'api.network_error',
    'api.response_error',
    'client.runtime_error',
]);
const clientDiagnosticSeverities = new Set(['info', 'warn', 'error']);
const migrationModes = new Set(['audit', 'apply']);
const migrationStates = new Set(['completed', 'failed', 'paused', 'running']);

const emptyContextSchema = z.object({}).strict();
const eventContextSchemas = Object.freeze({
    'account.section_viewed': z.object({
        section: z.enum(accountSections),
    }).strict(),
    'account.profile_updated': z.object({
        changedFields: z.array(z.enum(profileFields)).max(profileFields.length),
    }).strict(),
    'account.address_added': z.object({
        addressType: z.enum(['home', 'work', 'other']),
    }).strict(),
    'account.preference_changed': z.object({
        topic: z.enum(preferenceTopics),
        channel: z.enum(['email', 'sms', 'push']),
        enabled: z.boolean(),
    }).strict(),
    'account.order_searched': z.object({
        hasQuery: z.boolean(),
        status: z.enum(['', 'placed', 'processing', 'shipped', 'delivered', 'cancelled']),
        hasDateRange: z.boolean(),
    }).strict(),
    'account.return_started': z.object({
        resolution: z.enum(['refund', 'replacement']),
    }).strict(),
    'account.buy_again_selected': z.object({
        itemCountBucket: z.enum(['1', '2-5', '6+']),
    }).strict(),
    'account.passkey_added': emptyContextSchema,
    'account.session_revoked': z.object({
        scope: z.enum(['one', 'others', 'all', 'current']),
    }).strict(),
    'account.export_requested': emptyContextSchema,
    'account.deactivation_initiated': emptyContextSchema,
    'account.deletion_initiated': emptyContextSchema,
    'account.web_vital': z.object({
        metric: z.enum(['LCP', 'INP', 'CLS']),
        value: z.number().finite().min(0).max(600000),
        rating: z.enum(['good', 'needs_improvement', 'poor']),
        navigationType: z.enum(['navigate', 'reload', 'back_forward', 'prerender', 'unknown']),
    }).strict(),
});

const getOrCreateCounter = (name, help, labelNames) => (
    registry.getSingleMetric(name)
    || new client.Counter({ name, help, labelNames, registers: [registry] })
);

const getOrCreateHistogram = (name, help, labelNames, buckets) => (
    registry.getSingleMetric(name)
    || new client.Histogram({
        name,
        help,
        labelNames,
        buckets,
        registers: [registry],
    })
);

const getOrCreateGauge = (name, help, labelNames) => (
    registry.getSingleMetric(name)
    || new client.Gauge({
        name,
        help,
        labelNames,
        registers: [registry],
    })
);

const getAccountProductEventCounter = () => getOrCreateCounter(
    PRODUCT_EVENT_METRIC_NAME,
    'Privacy-safe Account Center product events by typed name and bounded dimension.',
    ['event', 'dimension']
);

const getAccountOperationCounter = () => getOrCreateCounter(
    ACCOUNT_OPERATION_METRIC_NAME,
    'Account Center operation results by bounded operation and outcome.',
    ['operation', 'outcome']
);

const getAccountOperationDuration = () => getOrCreateHistogram(
    ACCOUNT_OPERATION_DURATION_METRIC_NAME,
    'Account Center operation duration in seconds.',
    ['operation', 'outcome'],
    [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
);

const getAccountMigrationRunCounter = () => getOrCreateCounter(
    ACCOUNT_MIGRATION_RUN_METRIC_NAME,
    'Account Center migration outcomes by bounded mode and status.',
    ['mode', 'status']
);

const getAccountMigrationPendingGauge = () => getOrCreateGauge(
    ACCOUNT_MIGRATION_PENDING_METRIC_NAME,
    'Last observed Account Center migration pending-document count.',
    ['mode']
);

const getAccountMigrationModifiedGauge = () => getOrCreateGauge(
    ACCOUNT_MIGRATION_MODIFIED_METRIC_NAME,
    'Last observed Account Center migration modified-document count.',
    ['mode']
);

const refreshAccountMigrationMetrics = async ({
    connected = mongoose.connection.readyState === 1,
    loadSnapshot = () => AccountCenterMigrationRun.aggregate([
        {
            $facet: {
                counts: [
                    {
                        $group: {
                            _id: { mode: '$mode', status: '$status' },
                            value: { $sum: 1 },
                        },
                    },
                ],
                latest: [
                    { $sort: { updatedAt: -1 } },
                    {
                        $group: {
                            _id: '$mode',
                            pending: { $first: '$pendingAfter' },
                            modified: { $first: '$modified' },
                        },
                    },
                ],
            },
        },
    ]),
} = {}) => {
    if (!connected) return false;

    try {
        const [snapshot = {}] = await loadSnapshot();
        const runCounter = getAccountMigrationRunCounter();
        const pendingGauge = getAccountMigrationPendingGauge();
        const modifiedGauge = getAccountMigrationModifiedGauge();
        runCounter.reset();
        pendingGauge.reset();
        modifiedGauge.reset();
        for (const entry of snapshot.counts || []) {
            runCounter.inc({
                mode: migrationModes.has(entry?._id?.mode) ? entry._id.mode : 'audit',
                status: migrationStates.has(entry?._id?.status) ? entry._id.status : 'failed',
            }, Math.max(0, Number(entry?.value) || 0));
        }
        for (const entry of snapshot.latest || []) {
            const mode = migrationModes.has(entry?._id) ? entry._id : 'audit';
            pendingGauge.set({ mode }, Math.max(0, Number(entry?.pending) || 0));
            modifiedGauge.set({ mode }, Math.max(0, Number(entry?.modified) || 0));
        }
        return true;
    } catch (error) {
        logger.debug('account.migration_metric_refresh_failed', { error: error?.message || 'unknown' });
        return false;
    }
};

const validateAccountProductEvent = (event = {}) => {
    const type = String(event.type || '').trim();
    if (!type.startsWith(ACCOUNT_EVENT_PREFIX)) {
        return { applicable: false, success: true, data: null, issues: [] };
    }
    const schema = eventContextSchemas[type];
    if (!schema) {
        return {
            applicable: true,
            success: false,
            data: null,
            issues: [`Unknown account telemetry event type: ${type || 'missing'}`],
        };
    }
    const parsed = schema.safeParse(event.context || {});
    return {
        applicable: true,
        success: parsed.success,
        data: parsed.success ? parsed.data : null,
        issues: parsed.success
            ? []
            : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'context'}: ${issue.message}`),
    };
};

const normalizeTimestamp = (value) => {
    const now = new Date();
    const parsed = new Date(value || now);
    if (Number.isNaN(parsed.getTime())) return now;
    const driftMs = Math.abs(parsed.getTime() - now.getTime());
    return driftMs <= 24 * 60 * 60 * 1000 ? parsed : now;
};

const getProductEventSurface = (type, context = {}) => {
    if (type === 'account.section_viewed') return context.section;
    if (type.startsWith('account.order_') || type.includes('return_') || type.includes('buy_again')) return 'orders';
    if (type.includes('export_') || type.includes('deactivation_') || type.includes('deletion_')) return 'privacy';
    if (type.includes('passkey_') || type.includes('session_')) return 'settings';
    return 'account_center';
};

const normalizeAccountProductEvent = (event = {}) => {
    const validated = validateAccountProductEvent(event);
    if (!validated.applicable || !validated.success) return null;
    const type = String(event.type);
    const timestamp = normalizeTimestamp(event.timestamp);
    return {
        eventId: '',
        type,
        severity: 'info',
        timestamp,
        route: getProductEventSurface(type, validated.data),
        sessionId: '',
        requestId: '',
        serverRequestId: '',
        method: '',
        url: '',
        detail: '',
        status: undefined,
        durationMs: undefined,
        error: {},
        context: validated.data,
        ingestionRequestId: '',
        clientIp: '',
        userAgent: '',
        ingestedAt: new Date(),
    };
};

const getProductEventDimension = (diagnostic = {}) => {
    const context = diagnostic.context || {};
    return String(
        context.section
        || context.topic
        || context.resolution
        || context.scope
        || context.metric
        || context.addressType
        || 'none'
    );
};

const recordWebVital = (context = {}) => {
    const value = Number(context.value || 0);
    const labels = { rating: context.rating };
    if (context.metric === 'LCP') {
        getOrCreateHistogram(
            'aura_account_web_vital_lcp_seconds',
            'Account Center Largest Contentful Paint in seconds.',
            ['rating'],
            [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10]
        ).observe(labels, value / 1000);
    } else if (context.metric === 'INP') {
        getOrCreateHistogram(
            'aura_account_web_vital_inp_seconds',
            'Account Center Interaction to Next Paint in seconds.',
            ['rating'],
            [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2]
        ).observe(labels, value / 1000);
    } else if (context.metric === 'CLS') {
        getOrCreateHistogram(
            'aura_account_web_vital_cls_ratio',
            'Account Center Cumulative Layout Shift score.',
            ['rating'],
            [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1]
        ).observe(labels, value);
    }
};

const recordAccountProductEvent = (diagnostic = {}) => {
    if (!ACCOUNT_PRODUCT_EVENT_TYPE_SET.has(String(diagnostic.type || ''))) return;
    try {
        getAccountProductEventCounter().inc({
            event: diagnostic.type,
            dimension: getProductEventDimension(diagnostic),
        });
        if (diagnostic.type === 'account.web_vital') {
            recordWebVital(diagnostic.context);
        }
    } catch (error) {
        logger.debug('account.product_event_metric_failed', { error: error?.message || 'unknown' });
    }
};

const observeAccountOperation = (operation) => {
    const normalizedOperation = accountOperations.has(operation) ? operation : 'unknown';
    return (_req, res, next) => {
        const startedAt = process.hrtime.bigint();
        res.once('finish', () => {
            const statusCode = Number(res.statusCode || 0);
            const outcome = statusCode < 400
                ? 'success'
                : statusCode < 500
                    ? 'rejected'
                    : 'failed';
            const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
            try {
                getAccountOperationCounter().inc({ operation: normalizedOperation, outcome });
                getAccountOperationDuration().observe(
                    { operation: normalizedOperation, outcome },
                    durationSeconds
                );
            } catch (error) {
                logger.debug('account.operation_metric_failed', { error: error?.message || 'unknown' });
            }
        });
        next();
    };
};

const recordAccountPrivacyJobState = ({ type, status } = {}) => {
    const normalizedType = privacyJobTypes.has(String(type || '')) ? String(type) : 'unknown';
    const normalizedStatus = privacyJobStates.has(String(status || '')) ? String(status) : 'unknown';
    try {
        getOrCreateCounter(
            ACCOUNT_PRIVACY_JOB_METRIC_NAME,
            'Account privacy job transitions by bounded job type and state.',
            ['job_type', 'state']
        ).inc({ job_type: normalizedType, state: normalizedStatus });
    } catch (error) {
        logger.debug('account.privacy_job_metric_failed', { error: error?.message || 'unknown' });
    }
};

const recordClientDiagnostic = ({ type, severity } = {}) => {
    const normalizedType = clientDiagnosticTypes.has(String(type || '')) ? String(type) : 'other';
    const normalizedSeverity = clientDiagnosticSeverities.has(String(severity || ''))
        ? String(severity)
        : 'info';
    try {
        getOrCreateCounter(
            CLIENT_DIAGNOSTIC_METRIC_NAME,
            'Privacy-safe client diagnostics by bounded type and severity.',
            ['type', 'severity']
        ).inc({ type: normalizedType, severity: normalizedSeverity });
    } catch (error) {
        logger.debug('client.diagnostic_metric_failed', { error: error?.message || 'unknown' });
    }
};

const recordAccountMigrationState = ({
    mode,
    status,
    pending = 0,
    modified = 0,
} = {}) => {
    const normalizedMode = migrationModes.has(String(mode || '')) ? String(mode) : 'audit';
    const normalizedStatus = migrationStates.has(String(status || '')) ? String(status) : 'failed';
    try {
        getAccountMigrationRunCounter().inc({ mode: normalizedMode, status: normalizedStatus });
        const pendingGauge = getAccountMigrationPendingGauge();
        const modifiedGauge = getAccountMigrationModifiedGauge();
        pendingGauge.set({ mode: normalizedMode }, Math.max(0, Number(pending) || 0));
        modifiedGauge.set({ mode: normalizedMode }, Math.max(0, Number(modified) || 0));
    } catch (error) {
        logger.debug('account.migration_metric_failed', { error: error?.message || 'unknown' });
    }
};

getAccountProductEventCounter();
getAccountOperationCounter();
getAccountOperationDuration();
getAccountMigrationRunCounter();
getAccountMigrationPendingGauge();
getAccountMigrationModifiedGauge();

module.exports = {
    ACCOUNT_MIGRATION_MODIFIED_METRIC_NAME,
    ACCOUNT_MIGRATION_PENDING_METRIC_NAME,
    ACCOUNT_MIGRATION_RUN_METRIC_NAME,
    ACCOUNT_OPERATION_DURATION_METRIC_NAME,
    ACCOUNT_OPERATION_METRIC_NAME,
    ACCOUNT_PRIVACY_JOB_METRIC_NAME,
    ACCOUNT_PRODUCT_EVENT_TYPES,
    CLIENT_DIAGNOSTIC_METRIC_NAME,
    PRODUCT_EVENT_METRIC_NAME,
    normalizeAccountProductEvent,
    observeAccountOperation,
    recordAccountMigrationState,
    recordAccountPrivacyJobState,
    recordAccountProductEvent,
    recordClientDiagnostic,
    refreshAccountMigrationMetrics,
    validateAccountProductEvent,
    __private: {
        getProductEventDimension,
        normalizeTimestamp,
    },
};
