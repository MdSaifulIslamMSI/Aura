const { requireSecurityDecision } = require('../../middleware/requireSecurityDecision');
const { __resetBufferedEvents } = require('../../security/securityEventLogger');

const buildRes = () => {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        set(name, value) {
            this.headers[name] = value;
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

describe('requireSecurityDecision middleware', () => {
    beforeEach(() => {
        __resetBufferedEvents();
    });

    test('continues allowed requests', () => {
        const req = {
            method: 'GET',
            originalUrl: '/api/products',
            headers: {},
            user: null,
        };
        const res = buildRes();
        const next = jest.fn();

        requireSecurityDecision('product.view')(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.body).toBeNull();
    });

    test('returns step-up response for stale critical action', () => {
        const req = {
            method: 'POST',
            originalUrl: '/api/admin/users/123/role',
            headers: {},
            ip: '127.0.0.1',
            user: { _id: 'admin-1', role: 'admin', tenantId: 'tenant-1' },
            sessionAgeSeconds: 60,
        };
        const res = buildRes();
        const next = jest.fn();

        requireSecurityDecision('admin.role.change', {
            context: {
                mfaFresh: true,
                passkeyFresh: false,
                csrfVerified: true,
            },
        })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.step_up_required).toBe(true);
    });
});
