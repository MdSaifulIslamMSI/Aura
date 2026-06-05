jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const { authorizeResource } = require('../security/invisibleFabric/resourceAuthorization');
const {
    assertReplayGuard,
    resetInvisibleReplayMemoryForTests,
} = require('../security/invisibleFabric/replayGuard');
const {
    evaluateSensitiveActionGateway,
} = require('../security/invisibleFabric/sensitiveActionGateway');

describe('Invisible Fabric object authorization', () => {
    afterEach(() => resetInvisibleReplayMemoryForTests());

    test('User A cannot read or mutate User B order', () => {
        const read = authorizeResource({
            actor: { _id: 'user-a' },
            action: 'order.read',
            resource: { type: 'order', ownerId: 'user-b', id: 'order-1' },
        });
        const mutate = authorizeResource({
            actor: { _id: 'user-a' },
            action: 'order.status.change',
            resource: { type: 'order', ownerId: 'user-b', id: 'order-1' },
        });

        expect(read).toMatchObject({ allowed: false, reasonCode: 'owner_mismatch' });
        expect(mutate).toMatchObject({ allowed: false, reasonCode: 'owner_mismatch' });
    });

    test('cross-tenant access and unknown resource/action deny by default', () => {
        expect(authorizeResource({
            actor: { _id: 'seller-a', tenantId: 'tenant-a' },
            action: 'listing.write',
            resource: { type: 'listing', ownerId: 'seller-a', tenantId: 'tenant-b' },
        })).toMatchObject({ allowed: false, reasonCode: 'tenant_mismatch' });

        expect(authorizeResource({
            actor: { _id: 'user-a' },
            action: 'unknown.action',
            resource: { type: 'order', ownerId: 'user-a' },
        })).toMatchObject({ allowed: false, reasonCode: 'unknown_action' });

        expect(authorizeResource({
            actor: { _id: 'user-a' },
            action: 'order.read',
            resource: { type: 'spaceship', ownerId: 'user-a' },
        })).toMatchObject({ allowed: false, reasonCode: 'unknown_resource_type' });
    });

    test('normal users cannot perform admin actions and admins need step-up when required', () => {
        expect(authorizeResource({
            actor: { _id: 'user-a' },
            action: 'admin.users.mutate',
            resource: { type: 'user', ownerId: 'user-b' },
        })).toMatchObject({ allowed: false });

        expect(authorizeResource({
            actor: { _id: 'admin-a', isAdmin: true },
            action: 'admin.users.mutate',
            resource: { type: 'user', ownerId: 'user-b' },
            context: { requireStepUp: true },
        })).toMatchObject({ allowed: false, reasonCode: 'admin_step_up_required' });
    });

    test('disabled or suspended users are denied', () => {
        expect(authorizeResource({
            actor: { _id: 'user-a', accountState: 'disabled' },
            action: 'order.read',
            resource: { type: 'order', ownerId: 'user-a' },
        })).toMatchObject({ allowed: false, reasonCode: 'actor_disabled' });
    });
});

describe('Invisible Fabric replay guard and sensitive action gateway', () => {
    afterEach(() => resetInvisibleReplayMemoryForTests());

    test('first request is allowed, replay and cross-session nonce reuse are denied', async () => {
        const timestamp = Date.now();
        const first = await assertReplayGuard({
            actorId: 'user-a',
            sessionId: 'session-a',
            intent: 'upload_media',
            resourceType: 'upload',
            resourceId: 'upload-1',
            nonce: 'nonce-a',
            timestamp,
        });
        const replay = await assertReplayGuard({
            actorId: 'user-a',
            sessionId: 'session-a',
            intent: 'upload_media',
            resourceType: 'upload',
            resourceId: 'upload-1',
            nonce: 'nonce-a',
            timestamp,
        });
        const differentSession = await assertReplayGuard({
            actorId: 'user-a',
            sessionId: 'session-b',
            intent: 'upload_media',
            resourceType: 'upload',
            resourceId: 'upload-1',
            nonce: 'nonce-a',
            timestamp,
        });

        expect(first.ok).toBe(true);
        expect(replay).toMatchObject({ ok: false, reasons: ['replayed_nonce'] });
        expect(differentSession).toMatchObject({ ok: false, reasons: ['nonce_binding_mismatch'] });
    });

    test('expired and missing nonce requests are denied', async () => {
        expect(await assertReplayGuard({
            actorId: 'user-a',
            sessionId: 'session-a',
            intent: 'upload_media',
            resourceType: 'upload',
            resourceId: 'upload-1',
            nonce: '',
            timestamp: Date.now(),
        })).toMatchObject({ ok: false, reasons: expect.arrayContaining(['missing_nonce']) });

        expect(await assertReplayGuard({
            actorId: 'user-a',
            sessionId: 'session-a',
            intent: 'upload_media',
            resourceType: 'upload',
            resourceId: 'upload-1',
            nonce: 'nonce-expired',
            timestamp: Date.now() - 600_000,
            ttlSeconds: 60,
        })).toMatchObject({ ok: false, reasons: expect.arrayContaining(['expired_timestamp']) });
    });

    test('sensitive action gateway allows owner action and denies bypass', async () => {
        const allowed = await evaluateSensitiveActionGateway({
            actor: { _id: 'user-a' },
            resource: { type: 'upload', ownerId: 'user-a', id: 'upload-1' },
            contract: {
                intent: 'upload_media',
                resourceType: 'upload',
                resourceId: 'upload-1',
                clientContext: {
                    nonce: 'nonce-gateway',
                    timestamp: Date.now(),
                },
            },
            context: {
                sessionId: 'session-a',
                replayGuardRequired: true,
            },
        });
        const denied = await evaluateSensitiveActionGateway({
            actor: { _id: 'user-b' },
            resource: { type: 'upload', ownerId: 'user-a', id: 'upload-1' },
            contract: {
                intent: 'upload_media',
                resourceType: 'upload',
                resourceId: 'upload-1',
                clientContext: {
                    nonce: 'nonce-gateway-deny',
                    timestamp: Date.now(),
                },
            },
            context: {
                sessionId: 'session-b',
                replayGuardRequired: true,
            },
        });

        expect(allowed).toMatchObject({ allowed: true, response: { ok: true } });
        expect(denied).toMatchObject({ allowed: false, reasonCode: 'owner_mismatch' });
    });
});
