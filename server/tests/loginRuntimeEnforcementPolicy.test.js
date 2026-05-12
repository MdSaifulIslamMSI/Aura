const ENV_KEYS = [
    'AUTH_RISK_ENGINE_MODE',
    'AUTH_SECURITY_OUTBOX_ENABLED',
    'PRIVILEGED_JIT_ACCESS_ENABLED',
];

const originalEnv = ENV_KEYS.reduce((snapshot, key) => {
    snapshot[key] = process.env[key];
    return snapshot;
}, {});

const restoreEnv = () => {
    for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
};

describe('loginRuntimeEnforcementPolicy', () => {
    afterEach(() => {
        restoreEnv();
        jest.resetModules();
    });

    test('defaults to monitor-only risk decisions and disabled write-side controls', () => {
        for (const key of ENV_KEYS) delete process.env[key];

        const { getLoginRuntimeEnforcementPolicy } = require('../config/loginRuntimeEnforcementPolicy');

        expect(getLoginRuntimeEnforcementPolicy()).toMatchObject({
            riskEngineMode: 'monitor',
            riskEngineMonitorOnly: true,
            riskEngineEnforced: false,
            authSecurityOutboxEnabled: false,
            privilegedJitAccessEnabled: false,
        });
    });

    test('accepts explicit staging/prod activation flags', () => {
        process.env.AUTH_RISK_ENGINE_MODE = 'enforce';
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'true';
        process.env.PRIVILEGED_JIT_ACCESS_ENABLED = 'yes';

        const { getLoginRuntimeEnforcementPolicy } = require('../config/loginRuntimeEnforcementPolicy');

        expect(getLoginRuntimeEnforcementPolicy()).toMatchObject({
            riskEngineMode: 'enforce',
            riskEngineMonitorOnly: false,
            riskEngineEnforced: true,
            authSecurityOutboxEnabled: true,
            privilegedJitAccessEnabled: true,
        });
    });

    test('falls back safely for invalid flag values', () => {
        process.env.AUTH_RISK_ENGINE_MODE = 'block_everything';
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'maybe';
        process.env.PRIVILEGED_JIT_ACCESS_ENABLED = 'maybe';

        const { getLoginRuntimeEnforcementPolicy } = require('../config/loginRuntimeEnforcementPolicy');

        expect(getLoginRuntimeEnforcementPolicy()).toMatchObject({
            riskEngineMode: 'monitor',
            authSecurityOutboxEnabled: false,
            privilegedJitAccessEnabled: false,
        });
    });

    test('feeds privileged access JIT from the shared runtime policy', () => {
        process.env.PRIVILEGED_JIT_ACCESS_ENABLED = 'true';

        const { getPrivilegedAccessPolicy } = require('../config/privilegedAccessPolicy');

        expect(getPrivilegedAccessPolicy().jitAccessEnabled).toBe(true);
    });
});
