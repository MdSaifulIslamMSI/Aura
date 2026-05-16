const AppError = require('../utils/AppError');
const { recordFailedAttempt } = require('../services/emergencyControlService');

const EMERGENCY_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'SECURITY_ADMIN']);

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const getBootstrapEmails = () => new Set(
    String(process.env.EMERGENCY_CONTROL_ADMIN_EMAILS || '')
        .split(',')
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean)
);

const getAdminRoles = (user = {}) => (Array.isArray(user.adminRoles) ? user.adminRoles : [])
    .map((role) => String(role || '').trim().toUpperCase())
    .filter(Boolean);

const hasEmergencyRole = (user = {}) => getAdminRoles(user).some((role) => EMERGENCY_ADMIN_ROLES.has(role));

const hasEmergencyBootstrapAccess = (user = {}) => {
    const bootstrapEmails = getBootstrapEmails();
    if (bootstrapEmails.size === 0) return false;
    return bootstrapEmails.has(normalizeEmail(user.email));
};

const hasSecondFactorPosture = (req = {}) => {
    const sessionAal = String(req.authSession?.aal || '').trim().toLowerCase();
    const sessionAmr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];
    const firebaseSecondFactor = String(req.authToken?.firebase?.sign_in_second_factor || '').trim();
    const sessionDeviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    return sessionAal === 'aal2'
        || Boolean(firebaseSecondFactor)
        || ['webauthn', 'browser_key'].includes(sessionDeviceMethod)
        || sessionAmr.some((entry) => ['firebase_mfa', 'webauthn', 'trusted_device', 'otp'].includes(entry));
};

const requireEmergencyControlRole = async (req, res, next) => {
    if (!req.user?.isAdmin) {
        await recordFailedAttempt({
            flagKey: req.params?.key || 'GLOBAL_MAINTENANCE',
            reason: 'emergency_control_not_admin',
            req,
            metadata: { path: req.originalUrl },
        });
        return next(new AppError('Emergency controls require admin access', 403));
    }

    if (hasEmergencyRole(req.user) || hasEmergencyBootstrapAccess(req.user)) {
        return next();
    }

    await recordFailedAttempt({
        flagKey: req.params?.key || 'GLOBAL_MAINTENANCE',
        reason: 'emergency_control_role_required',
        req,
        metadata: {
            path: req.originalUrl,
            roles: getAdminRoles(req.user),
            bootstrapConfigured: getBootstrapEmails().size > 0,
        },
    });
    return next(new AppError('Emergency controls require SUPER_ADMIN or SECURITY_ADMIN role', 403));
};

const requireEmergencySecondFactor = async (req, res, next) => {
    if (hasSecondFactorPosture(req)) return next();

    await recordFailedAttempt({
        flagKey: req.params?.key || 'GLOBAL_MAINTENANCE',
        reason: 'emergency_control_second_factor_required',
        req,
        metadata: { path: req.originalUrl },
    });
    return next(new AppError('Emergency control changes require a verified second factor', 403));
};

module.exports = {
    EMERGENCY_ADMIN_ROLES,
    hasEmergencyBootstrapAccess,
    hasEmergencyRole,
    requireEmergencyControlRole,
    requireEmergencySecondFactor,
};
