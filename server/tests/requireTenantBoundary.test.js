jest.mock('../security/securityEventLogger', () => ({
    writeSecurityEvent: jest.fn(),
}));

const { writeSecurityEvent } = require('../security/securityEventLogger');
const { requireTenantBoundary } = require('../middleware/requireTenantBoundary');

const createRes = () => {
    const res = {
        headers: {},
        statusCode: 200,
        body: undefined,
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
};

describe('requireTenantBoundary middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('allows requests where actor and resource tenants match', async () => {
        const res = createRes();
        const next = jest.fn();

        await requireTenantBoundary()(
            { user: { _id: 'u1', tenantId: 'tenant-A' }, resource: { tenantId: 'tenant-A' } },
            res,
            next
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(writeSecurityEvent).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
    });

    test('compares tenant ids as strings, not types', async () => {
        const next = jest.fn();

        await requireTenantBoundary()(
            { user: { tenantId: 42 }, resource: { tenantId: '42' } },
            createRes(),
            next
        );

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('denies cross-tenant access with 403 and a security event', async () => {
        const res = createRes();
        const next = jest.fn();

        await requireTenantBoundary({ action: 'order.read' })(
            { user: { _id: 'u1', tenantId: 'tenant-A' }, resource: { tenantId: 'tenant-B' }, requestId: 'req-x' },
            res,
            next
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(res.body).toMatchObject({ success: false, message: 'Not authorized.', requestId: 'req-x' });
        expect(writeSecurityEvent).toHaveBeenCalledTimes(1);
        expect(writeSecurityEvent.mock.calls[0][0]).toMatchObject({
            event: 'access.crossTenantDenied',
            decision: 'DENY',
            riskScore: 75,
            reasonCode: 'tenant_mismatch_or_missing',
            action: 'order.read',
            tenantId: 'tenant-A',
        });
        expect(writeSecurityEvent.mock.calls[0][0].metadata).toEqual({
            hasActorTenant: true,
            hasResourceTenant: true,
        });
    });

    test('returns 404 with a generic message when hideResourceExistence is set', async () => {
        const res = createRes();

        await requireTenantBoundary({ hideResourceExistence: true })(
            { user: { tenantId: 'a' }, resource: { tenantId: 'b' } },
            res,
            jest.fn()
        );

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toBe('Resource not found');
    });

    test('denies when the resource tenant cannot be resolved at all', async () => {
        const next = jest.fn();

        await requireTenantBoundary()({ user: { tenantId: 'a' } }, createRes(), next);

        expect(next).not.toHaveBeenCalled();
        expect(writeSecurityEvent.mock.calls[0][0].metadata).toEqual({
            hasActorTenant: true,
            hasResourceTenant: false,
        });
    });

    test('default resolver falls back through resource, params, body, then query', async () => {
        const next = jest.fn();
        const run = (req) => requireTenantBoundary()(req, createRes(), next);

        await run({ user: { tenantId: 'a' }, params: { tenantId: 'a' } });
        expect(next).toHaveBeenCalledTimes(1);

        await run({ user: { tenantId: 'a' }, body: { tenantId: 'a' } });
        expect(next).toHaveBeenCalledTimes(2);

        await run({ user: { tenantId: 'a' }, query: { tenantId: 'a' } });
        expect(next).toHaveBeenCalledTimes(3);
    });

    test('resource tenant takes precedence over query params', async () => {
        const next = jest.fn();

        await requireTenantBoundary()(
            {
                user: { tenantId: 'a' },
                resource: { tenantId: 'a' },
                query: { tenantId: 'spoofed' },
            },
            createRes(),
            next
        );

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('supports a custom tenant resolver', async () => {
        const next = jest.fn();
        const resolveTenantId = jest.fn().mockResolvedValue('a');

        await requireTenantBoundary({ resolveTenantId })(
            { user: { tenantId: 'a' } },
            createRes(),
            next
        );

        expect(resolveTenantId).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
