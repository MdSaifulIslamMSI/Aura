jest.mock('../security/resourceAuthorizationService', () => ({
    verifyResourceAuthorization: jest.fn(),
}));

jest.mock('../security/securityEventLogger', () => ({
    writeSecurityEvent: jest.fn(),
}));

const { verifyResourceAuthorization } = require('../security/resourceAuthorizationService');
const { writeSecurityEvent } = require('../security/securityEventLogger');
const { requireObjectOwnership, requireObjectOwnershipOrAdmin } = require('../middleware/requireObjectOwnership');

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

const baseDecision = (overrides = {}) => ({
    allowed: true,
    reasonCode: 'owner_match',
    redacted: false,
    auditRequired: false,
    ...overrides,
});

describe('requireObjectOwnership middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calls next() and stamps the decision when authorization allows', async () => {
        const decision = baseDecision();
        verifyResourceAuthorization.mockReturnValue(decision);
        const req = { user: { _id: 'u1' }, params: { id: 'r1' } };
        const res = createRes();
        const next = jest.fn();

        await requireObjectOwnership()(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.objectOwnershipDecision).toBe(decision);
        expect(res.statusCode).toBe(200);
        expect(writeSecurityEvent).toHaveBeenCalledTimes(1);
        expect(writeSecurityEvent.mock.calls[0][0]).toMatchObject({
            event: 'access.resourceAllowed',
            decision: 'ALLOW_WITH_AUDIT',
            riskScore: 20,
            reasonCode: 'owner_match',
        });
    });

    test('rejects with 403 and no-store when denied', async () => {
        verifyResourceAuthorization.mockReturnValue(baseDecision({ allowed: false, reasonCode: 'not_owner' }));
        const res = createRes();
        const next = jest.fn();

        await requireObjectOwnership()({ user: {} }, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(res.body).toMatchObject({ success: false, message: 'Not authorized.' });
        expect(writeSecurityEvent.mock.calls[0][0]).toMatchObject({
            event: 'access.denied',
            decision: 'DENY',
            riskScore: 70,
        });
    });

    test('returns 404 with a generic message when hideResourceExistence is set', async () => {
        verifyResourceAuthorization.mockReturnValue(baseDecision({ allowed: false, reasonCode: 'not_owner' }));
        const res = createRes();

        await requireObjectOwnership({ hideResourceExistence: true })({ user: {} }, res, jest.fn());

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toBe('Resource not found');
    });

    test('prefers a custom resolveResource and forwards the default resource owner', async () => {
        verifyResourceAuthorization.mockReturnValue(baseDecision());
        const resolveResource = jest.fn().mockResolvedValue({ id: 'custom', ownerId: 'owner-1' });

        await requireObjectOwnership({ resolveResource, resourceSensitivity: 'high' })({ user: {} }, createRes(), jest.fn());

        expect(resolveResource).toHaveBeenCalledTimes(1);
        expect(verifyResourceAuthorization).toHaveBeenCalledWith(expect.objectContaining({
            resource: { id: 'custom', ownerId: 'owner-1' },
            resourceOwnerId: 'owner-1',
            resourceSensitivity: 'high',
            allowAdminOverride: false,
        }));
    });

    test('falls back to params/body when no resource object exists', async () => {
        verifyResourceAuthorization.mockReturnValue(baseDecision());

        await requireObjectOwnership()({
            user: {},
            params: { resourceId: 'res-7', userId: 'owner-9', tenantId: 't-1' },
        }, createRes(), jest.fn());

        expect(verifyResourceAuthorization).toHaveBeenCalledWith(expect.objectContaining({
            resource: { id: 'res-7', ownerId: 'owner-9', tenantId: 't-1' },
            resourceOwnerId: 'owner-9',
        }));
    });

    test('requireObjectOwnershipOrAdmin enables the admin override', async () => {
        verifyResourceAuthorization.mockReturnValue(baseDecision());

        await requireObjectOwnershipOrAdmin()({ user: {} }, createRes(), jest.fn());

        expect(verifyResourceAuthorization).toHaveBeenCalledWith(expect.objectContaining({
            allowAdminOverride: true,
        }));
    });

    test('routes thrown authorization errors to next(error)', async () => {
        verifyResourceAuthorization.mockImplementation(() => {
            throw new Error('auth backend down');
        });
        const res = createRes();
        const next = jest.fn();

        await requireObjectOwnership()({ user: {} }, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(next.mock.calls[0][0].message).toBe('auth backend down');
        expect(res.statusCode).toBe(200);
    });
});
