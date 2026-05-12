const {
    DEFAULT_NON_PRODUCTION_BOOT_GRACE_PERIOD_SEC,
    buildStartupReadinessFailure,
    getBootGracePeriodSec,
    getReadinessGraceState,
} = require('../services/healthReadinessService');

describe('healthReadinessService', () => {
    test('defaults production readiness to no boot grace', () => {
        expect(getBootGracePeriodSec({
            env: {},
            runtimeNodeEnv: 'production',
        })).toBe(0);
    });

    test('keeps a non-production grace window for local and test runtimes', () => {
        expect(getBootGracePeriodSec({
            env: {},
            runtimeNodeEnv: 'test',
        })).toBe(DEFAULT_NON_PRODUCTION_BOOT_GRACE_PERIOD_SEC);
    });

    test('allows explicit boot grace override without accepting negative values', () => {
        expect(getBootGracePeriodSec({
            env: { BOOT_GRACE_PERIOD_SEC: '30' },
            runtimeNodeEnv: 'production',
        })).toBe(30);
        expect(getBootGracePeriodSec({
            env: { BOOT_GRACE_PERIOD_SEC: '-10' },
            runtimeNodeEnv: 'production',
        })).toBe(0);
    });

    test('reports whether the process is inside the configured readiness grace period', () => {
        expect(getReadinessGraceState({
            env: { BOOT_GRACE_PERIOD_SEC: '30' },
            runtimeNodeEnv: 'production',
            uptime: 12,
        })).toEqual({
            bootGracePeriodSec: 30,
            isWithinGracePeriod: true,
        });
    });

    test('fails closed on async startup errors after grace', () => {
        expect(buildStartupReadinessFailure({
            runtimeNodeEnv: 'production',
            runtimeStartupState: {
                asyncStartupComplete: false,
                asyncStartupError: 'redis unavailable',
            },
            isWithinGracePeriod: false,
            uptime: 40,
            timestamp: '2026-05-03T00:00:00.000Z',
        })).toEqual({
            ready: false,
            reason: 'async_startup_failed',
            uptime: 40,
            timestamp: '2026-05-03T00:00:00.000Z',
            startup: {
                asyncStartupComplete: false,
                asyncStartupHealthy: false,
            },
        });
    });

    test('fails closed in production until async startup completes', () => {
        expect(buildStartupReadinessFailure({
            runtimeNodeEnv: 'production',
            runtimeStartupState: {
                asyncStartupComplete: false,
                asyncStartupError: '',
            },
            isWithinGracePeriod: false,
            uptime: 3,
            timestamp: '2026-05-03T00:00:00.000Z',
        })).toMatchObject({
            ready: false,
            reason: 'async_startup_incomplete',
        });
    });

    test('does not fail local readiness while still inside grace', () => {
        expect(buildStartupReadinessFailure({
            runtimeNodeEnv: 'development',
            runtimeStartupState: {
                asyncStartupComplete: false,
                asyncStartupError: '',
            },
            isWithinGracePeriod: true,
            uptime: 3,
        })).toBeNull();
    });
});
