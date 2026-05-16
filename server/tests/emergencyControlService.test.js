const EmergencyControl = require('../models/EmergencyControl');
const EmergencyAuditLog = require('../models/EmergencyAuditLog');
const {
    activateFlag,
    buildPublicStatus,
    clearEmergencyCache,
    deactivateFlag,
    getAllFlagsForAdmin,
    isEnabled,
} = require('../services/emergencyControlService');

describe('EmergencyControlService', () => {
    const originalEnv = { ...process.env };

    const req = {
        requestId: 'req-emergency-1',
        ip: '203.0.113.10',
        get: (header) => (String(header).toLowerCase() === 'user-agent' ? 'jest-agent' : ''),
        user: {
            _id: '507f1f77bcf86cd799439011',
            email: 'security@example.com',
        },
    };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.restoreAllMocks();
        clearEmergencyCache();
    });

    test('reads active DB flags, ignores expired flags, and lets env override win', async () => {
        await EmergencyControl.create({
            key: 'DISABLE_PAYMENT',
            enabled: true,
            severity: 'high',
            scope: 'payment',
            userMessage: 'Payments paused',
            expiresAt: new Date(Date.now() + 60_000),
        });
        await EmergencyControl.create({
            key: 'DISABLE_CHECKOUT',
            enabled: true,
            severity: 'critical',
            scope: 'checkout',
            userMessage: 'Checkout paused',
            expiresAt: new Date(Date.now() - 60_000),
        });

        await expect(isEnabled('DISABLE_PAYMENT')).resolves.toBe(true);
        await expect(isEnabled('DISABLE_CHECKOUT')).resolves.toBe(false);

        process.env.EMERGENCY_DISABLE_PAYMENT = 'false';
        clearEmergencyCache();
        await expect(isEnabled('DISABLE_PAYMENT')).resolves.toBe(false);

        process.env.EMERGENCY_DISABLE_CHECKOUT = 'true';
        clearEmergencyCache();
        await expect(isEnabled('DISABLE_CHECKOUT')).resolves.toBe(true);
    });

    test('shows expired critical flags as inactive in admin data', async () => {
        await EmergencyControl.create({
            key: 'GLOBAL_MAINTENANCE',
            enabled: true,
            severity: 'critical',
            scope: 'global',
            userMessage: 'Maintenance',
            expiresAt: new Date(Date.now() - 1_000),
        });

        await expect(isEnabled('GLOBAL_MAINTENANCE')).resolves.toBe(false);
        const flags = await getAllFlagsForAdmin();
        const maintenance = flags.find((flag) => flag.key === 'GLOBAL_MAINTENANCE');

        expect(maintenance).toMatchObject({
            active: false,
            expired: true,
            severity: 'critical',
        });
    });

    test('rejects invalid flag keys', async () => {
        await expect(isEnabled('DROP_ALL_USERS')).rejects.toThrow('Invalid emergency flag key');
    });

    test('public status redacts internal fields and sanitizes banner messages', async () => {
        await activateFlag('SHOW_EMERGENCY_BANNER', {
            reason: '<script>secret()</script> internal',
            userMessage: '<img src=x onerror=alert(1)>Payments paused<script>bad()</script>',
            severity: 'medium',
            expiresAt: new Date(Date.now() + 60_000),
            req,
        });
        await activateFlag('DISABLE_PAYMENT', {
            reason: 'provider outage',
            userMessage: 'Payments paused',
            severity: 'high',
            expiresAt: new Date(Date.now() + 60_000),
            req,
        });

        const status = await buildPublicStatus();
        const serialized = JSON.stringify(status);

        expect(status).toMatchObject({
            maintenance: false,
            readOnly: false,
        });
        expect(status.disabledFeatures).toContain('payment');
        expect(status.bannerMessage).toContain('Payments paused');
        expect(serialized).not.toContain('internalReason');
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('<script');
        expect(serialized).not.toContain('onerror');
    });

    test('creates requestId-bearing hash-chained audit logs on activation and deactivation', async () => {
        await activateFlag('DISABLE_OTP_SEND', {
            reason: 'otp abuse',
            userMessage: 'Verification is temporarily unavailable. Please try again later.',
            severity: 'high',
            expiresAt: new Date(Date.now() + 60_000),
            req,
        });
        await deactivateFlag('DISABLE_OTP_SEND', {
            reason: 'otp provider stable',
            req,
        });

        const logs = await EmergencyAuditLog.find({ flagKey: 'DISABLE_OTP_SEND' }).sort({ createdAt: 1 }).lean();

        expect(logs).toHaveLength(2);
        expect(logs[0]).toMatchObject({
            action: 'ACTIVATE',
            requestId: 'req-emergency-1',
            performedByEmail: 'security@example.com',
        });
        expect(logs[0].currentHash).toEqual(expect.any(String));
        expect(logs[1]).toMatchObject({
            action: 'DEACTIVATE',
            previousHash: logs[0].currentHash,
            requestId: 'req-emergency-1',
        });
    });

    test('fails closed for sensitive evaluations and open for public reads when config cannot be read', async () => {
        jest.spyOn(EmergencyControl, 'find').mockImplementation(() => ({
            lean: jest.fn().mockRejectedValue(new Error('config store down')),
        }));
        clearEmergencyCache();

        await expect(isEnabled('DISABLE_PAYMENT', { failClosed: true })).resolves.toBe(true);
        clearEmergencyCache();
        await expect(isEnabled('GLOBAL_MAINTENANCE', { failClosed: false })).resolves.toBe(false);
    });

    test('emergency audit logs are append-only', async () => {
        await EmergencyAuditLog.create({
            action: 'FAILED_ATTEMPT',
            flagKey: 'GLOBAL_MAINTENANCE',
            performedByEmail: 'actor@example.com',
            reason: 'test',
            requestId: 'req-immutable',
            currentHash: 'hash',
        });

        await expect(
            EmergencyAuditLog.updateOne({ flagKey: 'GLOBAL_MAINTENANCE' }, { $set: { reason: 'mutated' } })
        ).rejects.toThrow('Emergency audit logs are immutable');
        await expect(
            EmergencyAuditLog.deleteMany({ flagKey: 'GLOBAL_MAINTENANCE' })
        ).rejects.toThrow('Emergency audit logs are immutable');
    });
});
