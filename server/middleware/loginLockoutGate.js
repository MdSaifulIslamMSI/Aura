const {
    evaluateAccountLockout,
    recordAuthFailure,
    recordAuthSuccess,
} = require('../services/loginLockoutService');
const { writeSecurityEvent } = require('../security/securityEventLogger');
const { resolveTrustedDeviceFingerprint } = require('../services/deviceFingerprintAttestationService');

// Pre-route gate + post-route failure recorder for the distributed login
// lockout (Phase 5A). The gate blocks locked accounts in enforce mode and
// only observes in monitor mode; the recorder counts 401-class responses as
// failed attempts and clears counters after successful auth responses.

const identityForRequest = (req = {}) => {
    // Phase 5B: prefer the server-attested fingerprint over the client-asserted
    // header so fingerprint rotation cannot fragment limiter/lockout keys.
    let attestedFingerprint = '';
    try {
        attestedFingerprint = resolveTrustedDeviceFingerprint(req).fingerprint || '';
    } catch {
        attestedFingerprint = '';
    }
    return {
        uid: req.authUid || req.user?._id || '',
        email: req.body?.email || req.user?.email || '',
        phone: req.body?.phone || '',
        ip: req.ip || req.socket?.remoteAddress || '',
        fingerprint: attestedFingerprint || req.headers?.['x-device-fingerprint'] || '',
    };
};

const loginLockoutGate = ({ surface = 'auth' } = {}) => (req, res, next) => {
    const mode = require('../services/loginLockoutService').parseMode();
    if (mode === 'off') return next();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    const identity = identityForRequest(req);
    return evaluateAccountLockout(identity)
        .then((state) => {
            if (state.locked && mode === 'enforce') {
                writeSecurityEvent({
                    event: 'auth.lockout.blocked_request',
                    req,
                    action: surface,
                    riskScore: 90,
                    decision: 'BLOCK',
                    reasonCode: 'account_temporarily_locked',
                    metadata: {
                        surface,
                        retryAfterMs: state.retryAfterMs,
                        failures: state.failures,
                    },
                }, { level: 'warn' });

                res.set('Cache-Control', 'no-store');
                const retryAfterSeconds = Math.max(Math.ceil(state.retryAfterMs / 1000), 1);
                res.set('Retry-After', String(retryAfterSeconds));
                return res.status(429).json({
                    success: false,
                    code: 'ACCOUNT_TEMPORARILY_LOCKED',
                    message: 'Too many failed attempts. This account is temporarily locked. Try again later.',
                    requestId: req.requestId || '',
                });
            }

            if (state.locked && mode === 'monitor') {
                writeSecurityEvent({
                    event: 'auth.lockout.monitor_hit',
                    req,
                    action: surface,
                    riskScore: 70,
                    decision: 'OBSERVE',
                    reasonCode: 'account_temporarily_locked',
                    metadata: { surface, retryAfterMs: state.retryAfterMs, failures: state.failures },
                }, { level: 'warn' });
            }

            res.on('finish', () => {
                const status = res.statusCode;
                if (status >= 200 && status < 400) {
                    void recordAuthSuccess({ ...identity, surface });
                    return;
                }
                if (status === 401) {
                    void recordAuthFailure({ ...identity, surface, req });
                }
            });

            return next();
        })
        .catch((error) => {
            // Fail open: a lockout evaluation error must not take down auth.
            writeSecurityEvent({
                event: 'auth.lockout.evaluate_error',
                req,
                action: surface,
                decision: 'FAIL_OPEN',
                reasonCode: error?.message || 'unknown',
            }, { level: 'error' });
            return next();
        });
};

// Express error middleware: records 401-class auth failures produced by the
// route handlers (invalid OTP, bad MFA proof, rejected credentials).
const authFailureRecorder = ({ surface = 'auth' } = {}) => (err, req, res, next) => {
    const status = Number(err?.statusCode || err?.status || 0);
    if (status === 401) {
        void recordAuthFailure({
            ...identityForRequest(req),
            surface,
            req,
        }).catch(() => undefined);
    }
    return next(err);
};

module.exports = {
    loginLockoutGate,
    authFailureRecorder,
    identityForRequest,
};
