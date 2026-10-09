const { isProduction } = require('../utils/cryptoKdf');

// Startup contract for cryptographic domain separation.
//
// Every purpose that derives a key from a shared secret must own its own env
// var in production. The fallback chains in blindIndexService, authRecoveryCodeService
// and otpController exist so partially-configured environments keep working, but
// in production a silent fallback means two unrelated capabilities share key
// material: leak one and you get the other.
//
// This module is intentionally *only* about separation, not about the KDFs
// themselves. Derivation for persisted data (blind indexes, recovery-code hashes)
// is frozen — changing it invalidates stored values — so those checks live at the
// call site instead and are covered by tests.

const isSet = (value) => Boolean(String(value || '').trim());

// Purposes whose secret must be dedicated in production. `fallbacks` lists the
// variables each one is allowed to borrow from, so the error message can name
// the exact coupling being refused.
const DEDICATED_SECRETS = Object.freeze([
    {
        variable: 'PHONE_BLIND_INDEX_SECRET',
        label: 'phone blind index',
        fallbacks: ['OTP_FLOW_SECRET', 'JWT_SECRET'],
    },
    {
        variable: 'EMAIL_BLIND_INDEX_SECRET',
        label: 'email blind index',
        fallbacks: ['OTP_FLOW_SECRET', 'JWT_SECRET'],
    },
    {
        variable: 'OTP_HASH_SECRET',
        label: 'OTP hash pepper',
        fallbacks: ['OTP_FLOW_SECRET', 'JWT_SECRET'],
    },
    {
        variable: 'AUTH_RECOVERY_CODE_SECRET',
        label: 'recovery code HMAC',
        fallbacks: ['OTP_FLOW_SECRET', 'AUTH_DEVICE_CHALLENGE_SECRET'],
    },
    {
        variable: 'OTP_FLOW_SECRET',
        label: 'OTP flow token signing',
        fallbacks: [],
    },
    {
        variable: 'SECURITY_LOG_HASH_KEY',
        label: 'security log pseudonymisation',
        fallbacks: ['OTP_FLOW_SECRET', 'SESSION_SECRET', 'JWT_SECRET'],
    },
    {
        variable: 'MFA_SECRET_ENCRYPTION_KEY',
        label: 'TOTP secret encryption',
        fallbacks: [],
    },
]);

/**
 * @returns {{ok: boolean, missing: string[], shared: string[], collisions: Array<{variable: string, with: string}>}}
 */
const inspectCryptoSeparation = (env = process.env) => {
    const missing = [];
    const shared = [];
    const collisions = [];

    for (const entry of DEDICATED_SECRETS) {
        if (isSet(env[entry.variable])) continue;

        // MFA only needs its key when TOTP is actually on; redactSecurityMetadata
        // has its own prod fallbacks, so it is reported but not fatal there.
        if (entry.variable === 'MFA_SECRET_ENCRYPTION_KEY') {
            const totpOn = ['1', 'true', 'yes', 'on'].includes(
                String(env.MFA_TOTP_ENABLED || '').trim().toLowerCase()
            );
            if (!totpOn) continue;
        }

        const borrowedFrom = entry.fallbacks.find((name) => isSet(env[name]));
        if (borrowedFrom) {
            shared.push(`${entry.variable} (${entry.label}) is falling back to ${borrowedFrom}`);
            collisions.push({ variable: entry.variable, with: borrowedFrom });
        } else {
            missing.push(entry.variable);
        }
    }

    return { ok: missing.length === 0 && shared.length === 0, missing, shared, collisions };
};

/** Throws in production when any purpose lacks a dedicated secret. */
const assertCryptoSeparationConfig = (env = process.env) => {
    if (!isProduction()) return { enforced: false, ...inspectCryptoSeparation(env) };

    const report = inspectCryptoSeparation(env);

    if (report.missing.length > 0) {
        throw new Error(
            `Cryptographic secrets are not configured: ${report.missing.join(', ')}. `
            + 'Each purpose must own its secret; see server/config/cryptoSeparationPolicy.js.'
        );
    }

    if (report.shared.length > 0) {
        throw new Error(
            `Cryptographic secrets share key material in production: ${report.shared.join('; ')}. `
            + 'Set the dedicated variable instead of reusing another purpose\'s secret.'
        );
    }

    return { enforced: true, ...report };
};

module.exports = {
    DEDICATED_SECRETS,
    inspectCryptoSeparation,
    assertCryptoSeparationConfig,
};
