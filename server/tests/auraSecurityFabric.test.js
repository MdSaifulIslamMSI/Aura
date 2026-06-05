const express = require('express');
const request = require('supertest');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const logger = require('../utils/logger');
const {
    ACTION_SENSITIVITY_REGISTRY,
    REQUIRED_FIELDS,
    SENSITIVITY_LEVELS,
    getActionDefinition,
    validateActionRegistry,
} = require('../security/actionSensitivityRegistry');
const { evaluateAuraSecurityBrain } = require('../security/auraSecurityBrain');
const {
    INCIDENT_MODES,
    getCurrentMode,
    getIncidentEvents,
    recordCriticalSecurityDecision,
    resetIncidentModeForTests,
} = require('../security/incidentModeService');
const { redactSecurityValue } = require('../security/redaction');
const { resolveSecurityFabricConfig } = require('../security/securityFabricConfig');
const { SECURITY_DECISIONS } = require('../security/securityDecision');
const { buildSecurityDecisionEvent } = require('../security/securityEventLogger');
const { evaluateTenantIsolation } = require('../security/tenantGuard');
const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
const { requireTenantIsolation } = require('../middleware/requireTenantIsolation');

const ORIGINAL_ENV = { ...process.env };

const buildConfig = (overrides = {}) => resolveSecurityFabricConfig({
    NODE_ENV: 'test',
    AURA_SECURITY_FABRIC_ENABLED: 'true',
    AURA_SECURITY_FABRIC_AUDIT_ONLY: 'false',
    AURA_SECURITY_FABRIC_ENFORCE: 'true',
    AURA_SECURITY_BRAIN_ENABLED: 'true',
    AURA_SECURITY_BRAIN_ENFORCE: 'true',
    AURA_INCIDENT_MODE_ENABLED: 'true',
    AURA_SECURITY_EVENT_LOGGING_ENABLED: 'true',
    ...overrides,
});

const setFabricEnv = (overrides = {}) => {
    process.env = {
        ...ORIGINAL_ENV,
        NODE_ENV: 'test',
        AURA_SECURITY_FABRIC_ENABLED: 'true',
        AURA_SECURITY_FABRIC_AUDIT_ONLY: 'false',
        AURA_SECURITY_FABRIC_ENFORCE: 'true',
        AURA_SECURITY_BRAIN_ENABLED: 'true',
        AURA_SECURITY_BRAIN_ENFORCE: 'true',
        AURA_INCIDENT_MODE_ENABLED: 'true',
        AURA_SECURITY_EVENT_LOGGING_ENABLED: 'true',
        ...overrides,
    };
};

const baseContext = (overrides = {}) => ({
    requestId: 'req-1',
    actorId: 'user-1',
    actorRole: 'user',
    tenantId: 'tenant-1',
    sessionAgeSeconds: 60,
    mfaFresh: true,
    trustedDevice: true,
    method: 'POST',
    path: '/test',
    payloadSize: 0,
    ...overrides,
});

const decide = (action, contextOverrides = {}, resource = {}) => evaluateAuraSecurityBrain({
    actionDefinition: getActionDefinition(action),
    context: baseContext({ action, ...contextOverrides }),
    resource,
    config: buildConfig(),
});

const buildMiddlewareApp = ({
    middleware,
    user = null,
    posture = {},
    route = '/test',
} = {}) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.requestId = 'req-1';
        req.user = user;
        req.authzPosture = posture;
        next();
    });
    app.post(route, middleware, (req, res) => {
        res.json({
            ok: true,
            securityDecision: req.securityDecision,
            tenantGuardDecision: req.tenantGuardDecision,
        });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

describe('Aura Nuclear Umbrella Security Fabric', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
        resetIncidentModeForTests();
    });

    test('config defaults are audit-safe and non-enforcing', () => {
        const config = resolveSecurityFabricConfig({ NODE_ENV: 'production' });

        expect(config).toMatchObject({
            enabled: false,
            auditOnly: true,
            enforce: false,
            securityBrainEnabled: false,
            securityBrainEnforce: false,
            sensitiveActionStepUpEnabled: false,
            incidentModeEnabled: false,
            incidentModeEnforce: false,
            tenantGuardEnforce: false,
            eventLoggingEnabled: true,
            production: true,
        });
    });

    test('action registry entries are complete and critical actions carry MFA or an exception', () => {
        expect(validateActionRegistry()).toEqual([]);

        ACTION_SENSITIVITY_REGISTRY.forEach((item) => {
            REQUIRED_FIELDS.forEach((field) => {
                expect(item).toHaveProperty(field);
            });
            if (item.sensitivity === SENSITIVITY_LEVELS.CRITICAL) {
                expect(Boolean(item.requiresFreshMfa || item.freshMfaExceptionReason)).toBe(true);
            }
            if (/^(admin|payment|data)\./.test(item.action)) {
                expect(item.requiresAudit).toBe(true);
            }
        });
    });

    test('risk scoring maps low, medium, high, critical, and tenant mismatch cases', () => {
        expect(decide('auth.logout').decision).toBe(SECURITY_DECISIONS.ALLOW);
        expect(decide('admin.user.read', { actorRole: 'admin' }).decision).toBe(SECURITY_DECISIONS.AUDIT);

        const highWithoutMfa = decide('auth.trustedDevice.add', { mfaFresh: false });
        expect(highWithoutMfa).toMatchObject({
            decision: SECURITY_DECISIONS.STEP_UP,
        });
        expect(highWithoutMfa.requiredControls).toContain('fresh_mfa');

        const criticalMissingAuth = decide('admin.user.delete', {
            actorId: '',
            actorRole: 'anonymous',
            mfaFresh: false,
            trustedDevice: false,
        });
        expect([SECURITY_DECISIONS.DENY, SECURITY_DECISIONS.LOCKDOWN]).toContain(criticalMissingAuth.decision);

        const sameTenant = decide('tenant.resource.write', {}, { tenantId: 'tenant-1' });
        const crossTenant = decide('tenant.resource.write', {}, { tenantId: 'tenant-2' });
        expect(crossTenant.riskScore).toBeGreaterThan(sameTenant.riskScore);
        expect(crossTenant.reasons).toContain('cross_tenant_mismatch');
    });

    test('audit-only mode never blocks and logs the would-block decision', async () => {
        setFabricEnv({
            AURA_SECURITY_FABRIC_AUDIT_ONLY: 'true',
            AURA_SECURITY_FABRIC_ENFORCE: 'true',
            AURA_SECURITY_BRAIN_ENFORCE: 'true',
        });
        const app = buildMiddlewareApp({
            middleware: requireSecurityDecision('admin.user.delete', { resourceType: 'user' }),
        });

        const res = await request(app).post('/test').send({ password: 'secret' });

        expect(res.statusCode).toBe(200);
        expect(res.body.securityDecision.decision).toBe(SECURITY_DECISIONS.LOCKDOWN);
        expect(logger.info).toHaveBeenCalledWith('security.audit_event', expect.objectContaining({
            event: 'aura.security_fabric.decision',
            result: 'would_block',
            meta: expect.objectContaining({
                auditOnly: true,
                decision: SECURITY_DECISIONS.LOCKDOWN,
            }),
        }));
    });

    test('enforcement mode returns step-up, deny, and lockdown responses', async () => {
        setFabricEnv();
        const stepUpApp = buildMiddlewareApp({
            user: { _id: 'user-1' },
            posture: { trustedDevice: true },
            middleware: requireSecurityDecision('auth.trustedDevice.add', { resourceType: 'auth' }),
        });
        const stepUp = await request(stepUpApp).post('/test').send({});
        expect(stepUp.statusCode).toBe(428);
        expect(stepUp.body.code).toBe('STEP_UP_REQUIRED');

        const denyApp = buildMiddlewareApp({
            user: { _id: 'admin-1', isAdmin: true },
            posture: { trustedDevice: true },
            middleware: requireSecurityDecision('admin.user.delete', { resourceType: 'user' }),
        });
        const denied = await request(denyApp).post('/test').send({});
        expect(denied.statusCode).toBe(403);
        expect(denied.body.code).toBe('SECURITY_POLICY_DENIED');

        const lockdownApp = buildMiddlewareApp({
            middleware: requireSecurityDecision('admin.user.delete', { resourceType: 'user' }),
        });
        const lockdown = await request(lockdownApp).post('/test').send({});
        expect(lockdown.statusCode).toBe(423);
        expect(lockdown.body.code).toBe('SECURITY_LOCKDOWN');
    });

    test('redaction removes secrets from event-shaped data', () => {
        const redacted = redactSecurityValue({
            password: 'pw',
            token: 'token',
            otp: '123456',
            cookie: 'aura_sid=session',
            authorization: 'Bearer token',
            nested: {
                apiKey: 'key',
                webhookSecret: 'secret',
                safe: 'kept',
            },
        });

        expect(redacted).toEqual({
            password: '[REDACTED]',
            token: '[REDACTED]',
            otp: '[REDACTED]',
            cookie: '[REDACTED]',
            authorization: '[REDACTED]',
            nested: {
                apiKey: '[REDACTED]',
                webhookSecret: '[REDACTED]',
                safe: 'kept',
            },
        });

        const event = buildSecurityDecisionEvent({
            evaluation: {
                action: 'auth.login',
                decision: SECURITY_DECISIONS.AUDIT,
                riskScore: 35,
                reasons: ['test'],
                context: {
                    actorId: 'user-1',
                    requestId: 'req-1',
                    ipHash: 'ip-hash',
                    userAgentHash: 'ua-hash',
                },
            },
            config: buildConfig({ AURA_SECURITY_FABRIC_AUDIT_ONLY: 'true' }),
        });
        expect(event).toMatchObject({
            eventType: 'aura.security_fabric.decision',
            ipHash: 'ip-hash',
            userAgentHash: 'ua-hash',
        });
    });

    test('tenant guard passes same tenant, audits mismatch, and blocks when enforced', async () => {
        const sameTenant = evaluateTenantIsolation({
            req: { user: { _id: 'user-1', tenantId: 'tenant-1' }, headers: {} },
            resource: { tenantId: 'tenant-1' },
            config: buildConfig({ AURA_TENANT_GUARD_ENFORCE: 'true' }),
        });
        expect(sameTenant.decision).toBe(SECURITY_DECISIONS.ALLOW);

        setFabricEnv({
            AURA_SECURITY_FABRIC_AUDIT_ONLY: 'true',
            AURA_TENANT_GUARD_ENFORCE: 'false',
        });
        const auditApp = buildMiddlewareApp({
            route: '/test/:tenantId',
            user: { _id: 'user-1', tenantId: 'tenant-1' },
            middleware: requireTenantIsolation({ resourceTenantIdParam: 'tenantId' }),
        });
        const audited = await request(auditApp).post('/test/tenant-2').send({});
        expect(audited.statusCode).toBe(200);
        expect(audited.body.tenantGuardDecision.decision).toBe(SECURITY_DECISIONS.DENY);

        setFabricEnv({
            AURA_SECURITY_FABRIC_AUDIT_ONLY: 'false',
            AURA_TENANT_GUARD_ENFORCE: 'true',
        });
        const enforceApp = buildMiddlewareApp({
            route: '/test/:tenantId',
            user: { _id: 'user-1', tenantId: 'tenant-1' },
            middleware: requireTenantIsolation({ resourceTenantIdParam: 'tenantId' }),
        });
        const blocked = await request(enforceApp).post('/test/tenant-2').send({});
        expect(blocked.statusCode).toBe(403);
        expect(blocked.body.code).toBe('TENANT_ISOLATION_DENIED');
    });

    test('incident mode starts normal and repeated critical decisions create an internal incident event', () => {
        expect(getCurrentMode()).toBe(INCIDENT_MODES.NORMAL);

        for (let index = 0; index < 3; index += 1) {
            recordCriticalSecurityDecision({
                action: 'admin.user.delete',
                decision: { decision: SECURITY_DECISIONS.LOCKDOWN, riskScore: 98 },
                context: { requestId: `req-${index}` },
                now: 1000 + index,
            });
        }

        expect(getCurrentMode()).toBe(INCIDENT_MODES.HEIGHTENED);
        expect(getIncidentEvents()).toHaveLength(1);
        expect(getIncidentEvents()[0]).toMatchObject({
            reason: 'repeated_critical_security_decisions',
            mode: INCIDENT_MODES.HEIGHTENED,
        });
    });
});
