const authShield = require('../../security/authShield');
const { resetReplayMemoryForTests } = require('../../security/authShield/replayGuard');
const { resetRiskMemoryForTests } = require('../../security/authShield/riskEngine');
const { resetStepUpMemoryForTests } = require('../../security/authShield/stepUpService');

const withAuthShieldEnv = async (env, fn) => {
    const previous = {};
    Object.keys(env).forEach((key) => {
        previous[key] = process.env[key];
        process.env[key] = env[key];
    });
    try {
        return await fn();
    } finally {
        Object.keys(env).forEach((key) => {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        });
        resetReplayMemoryForTests();
        resetRiskMemoryForTests();
        resetStepUpMemoryForTests();
    }
};

const shieldEnv = ({
    enabled = 'true',
    shadow = 'false',
    stepUp = 'false',
    dpop = 'false',
    replay = 'true',
} = {}) => ({
    AUTH_SHIELD_ENABLED: enabled,
    AUTH_SHIELD_SHADOW_MODE: shadow,
    AUTH_SHIELD_AUDIT_ENABLED: 'false',
    AUTH_SHIELD_STEP_UP_ENABLED: stepUp,
    AUTH_SHIELD_DPOP_ENABLED: dpop,
    AUTH_SHIELD_REPLAY_GUARD_ENABLED: replay,
    AUTH_SHIELD_DEVICE_TRUST_ENABLED: 'false',
    AUTH_SHIELD_POLICY_VERSION: '2026-06-05-test',
});

let counter = 0;

const buildReq = ({
    userId = 'user-1',
    roles = ['user'],
    isAdmin = false,
    isSeller = false,
    authAgeSeconds = 60,
    nonce,
    method = 'POST',
    path = '/api/test',
    headers = {},
    body = {},
    accountState = 'active',
    emailVerified = true,
} = {}) => {
    counter += 1;
    const now = Math.floor(Date.now() / 1000);
    const resolvedNonce = nonce || `nonce-${counter}`;
    return {
        method,
        originalUrl: path,
        path,
        requestId: `req-${counter}`,
        headers: {
            'x-request-id': `req-${counter}`,
            'x-aura-nonce': resolvedNonce,
            'x-aura-device-id': `device-${counter}`,
            'user-agent': 'jest-agent',
            ...headers,
        },
        body,
        user: {
            _id: userId,
            id: userId,
            isAdmin,
            isSeller,
            roles,
            adminRoles: isAdmin ? ['SECURITY_ADMIN'] : [],
            isVerified: emailVerified,
            accountState,
            trustedDevices: [],
        },
        authToken: {
            auth_time: now - authAgeSeconds,
            email_verified: emailVerified,
            amr: ['mfa'],
        },
        authIdentity: {
            emailVerified,
        },
        authSession: {
            sessionId: `session-${counter}`,
            userId,
            amr: ['mfa'],
        },
    };
};

module.exports = {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
};
