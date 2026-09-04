'use strict';

jest.mock('../services/email', () => {
    const actual = jest.requireActual('../services/email');
    return {
        ...actual,
        sendTransactionalEmail: jest.fn(async () => ({ skipped: false })),
    };
});

const { sendTransactionalEmail } = require('../services/email');
const {
    NEW_DEVICE_EVENT,
    isFirstSeenDevice,
    notifyNewDeviceSignIn,
} = require('../services/authNewDeviceAlertService');
const { __getBufferedEvents, __resetBufferedEvents } = require('../security/securityEventLogger');

const makeUser = (overrides = {}) => ({
    _id: 'user-new-device-1',
    name: 'Device User',
    email: 'device.user@example.com',
    trustedDevices: [{ deviceId: 'device-known-1' }],
    ...overrides,
});

const makeReq = () => ({
    method: 'POST',
    path: '/api/auth/sync',
    ip: '203.0.113.10',
    headers: { 'user-agent': 'test-agent', 'x-request-id': 'req-new-device-1' },
    requestId: 'req-new-device-1',
});

describe('authNewDeviceAlertService', () => {
    const originalOutboxFlag = process.env.AUTH_SECURITY_OUTBOX_ENABLED;

    beforeEach(() => {
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'true';
        __resetBufferedEvents();
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (originalOutboxFlag === undefined) delete process.env.AUTH_SECURITY_OUTBOX_ENABLED;
        else process.env.AUTH_SECURITY_OUTBOX_ENABLED = originalOutboxFlag;
        __resetBufferedEvents();
    });

    test('isFirstSeenDevice distinguishes known, unknown, and missing devices', () => {
        const user = makeUser();
        expect(isFirstSeenDevice({ user, deviceId: 'device-brand-new' })).toBe(true);
        expect(isFirstSeenDevice({ user, deviceId: 'device-known-1' })).toBe(false);
        expect(isFirstSeenDevice({ user, deviceId: '' })).toBe(false);
        expect(isFirstSeenDevice({ user: { ...user, trustedDevices: undefined }, deviceId: 'x' })).toBe(false);
    });

    test('notifies on first-seen device with email, outbox, and telemetry', async () => {
        const outcome = await notifyNewDeviceSignIn({
            req: makeReq(),
            user: makeUser(),
            deviceId: 'device-brand-new-1',
        });

        expect(outcome).toEqual({ notified: true });
        expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
        expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'device.user@example.com',
        }));
        const telemetry = __getBufferedEvents().filter((e) => e.event === NEW_DEVICE_EVENT);
        expect(telemetry.length).toBe(1);
        expect(telemetry[0]).toMatchObject({ decision: 'NOTIFY', reasonCode: 'new_device_sign_in' });
    });

    test('stays silent for known devices', async () => {
        const outcome = await notifyNewDeviceSignIn({
            req: makeReq(),
            user: makeUser(),
            deviceId: 'device-known-1',
        });

        expect(outcome).toEqual({ notified: false, reason: 'known_device' });
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
    });

    test('throttles repeat alerts for the same device within 24h', async () => {
        const user = makeUser();
        const first = await notifyNewDeviceSignIn({ req: makeReq(), user, deviceId: 'device-repeat-1' });
        expect(first).toEqual({ notified: true });

        const second = await notifyNewDeviceSignIn({ req: makeReq(), user, deviceId: 'device-repeat-1' });
        expect(second).toEqual({ notified: false, reason: 'throttled' });
        expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    });

    test('never rejects when the email provider fails', async () => {
        sendTransactionalEmail.mockRejectedValueOnce(new Error('smtp down'));

        const outcome = await notifyNewDeviceSignIn({
            req: makeReq(),
            user: makeUser(),
            deviceId: 'device-smtp-down-1',
        });

        expect(outcome).toEqual({ notified: false, reason: 'error' });
    });

    test('skips without a usable recipient address', async () => {
        const outcome = await notifyNewDeviceSignIn({
            req: makeReq(),
            user: makeUser({ email: 'not-an-email' }),
            deviceId: 'device-brand-new-2',
        });

        expect(outcome).toEqual({ notified: false, reason: 'not_eligible' });
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
    });
});
