const AppError = require('../../utils/AppError');
const { listAuthorizationPolicy } = require('../../config/authorizationPolicy');
const { getPrivilegedAccessPolicy } = require('../../config/privilegedAccessPolicy');

const ROLE_ALIASES = new Map([
    ['admin', ['admin', 'ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN']],
    ['support', ['support', 'SUPPORT', 'SECURITY_ADMIN', 'ADMIN', 'SUPER_ADMIN']],
    ['seller', ['seller']],
    ['service', ['service', 'SERVICE']],
    ['user', ['user']],
]);

const ROLE_PERMISSIONS = {
    user: [
        'profile:read',
        'profile:update',
        'auth:session:*',
        'auth:trusted_device:*',
        'auth:recovery_codes:issue',
        'user:profile:*',
        'user:account:*',
        'order:read:self',
    ],
    seller: ['listing:manage:self', 'order:read:seller'],
    support: ['support:read', 'support:update', 'user:read:support'],
    admin: ['admin:*', 'user:*', 'catalog:*', 'order:*', 'payment:*'],
    service: ['service:*'],
};

const normalize = (value = '') => String(value || '').trim().toLowerCase();
const normalizePermission = (value = '') => normalize(value)
    .replace(/\.+/g, ':')
    .replace(/:+/g, ':');

const getUserRoles = (user = null) => {
    const roles = new Set();
    if (!user) return [];
    roles.add('user');
    if (user.isAdmin) roles.add('admin');
    if (user.isSeller) roles.add('seller');

    const adminRoles = Array.isArray(user.adminRoles) ? user.adminRoles : [];
    for (const role of adminRoles) {
        const normalized = normalize(role);
        if (!normalized) continue;
        if (normalized === 'security_admin') roles.add('support');
        if (normalized === 'admin' || normalized === 'super_admin' || normalized === 'security_admin') {
            roles.add('admin');
        }
    }

    const explicitRoles = Array.isArray(user.roles) ? user.roles : [];
    for (const role of explicitRoles) {
        const normalized = normalize(role);
        if (normalized) roles.add(normalized);
    }

    return Array.from(roles);
};

const roleMatches = (candidateRole = '', requiredRole = '') => {
    const candidate = normalize(candidateRole);
    const required = normalize(requiredRole);
    if (!candidate || !required) return false;
    if (candidate === required) return true;
    const aliases = ROLE_ALIASES.get(required) || [];
    return aliases.some((alias) => normalize(alias) === candidate);
};

const hasRole = (user = null, requiredRole = '') => getUserRoles(user)
    .some((role) => roleMatches(role, requiredRole));

const getUserPermissions = (user = null) => {
    const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions.map(normalize) : []);
    for (const role of getUserRoles(user)) {
        const rolePermissions = ROLE_PERMISSIONS[normalize(role)] || [];
        rolePermissions.forEach((permission) => permissions.add(normalize(permission)));
    }
    return Array.from(permissions).filter(Boolean);
};

const permissionMatches = (candidatePermission = '', requiredPermission = '') => {
    const candidate = normalizePermission(candidatePermission);
    const required = normalizePermission(requiredPermission);
    if (!candidate || !required) return false;
    if (candidate === required) return true;
    if (candidate.endsWith(':*')) {
        const scope = candidate.slice(0, -2);
        return required === scope || required.startsWith(`${scope}:`);
    }
    if (candidate.endsWith('*')) {
        return required.startsWith(candidate.slice(0, -1));
    }
    return false;
};

const hasPermission = (user = null, requiredPermission = '') => getUserPermissions(user)
    .some((permission) => permissionMatches(permission, requiredPermission));

const normalizeMethod = (value = '') => String(value || '').trim().toUpperCase();

const normalizeRequestPath = (value = '') => {
    const path = String(value || '')
        .split('?')[0]
        .trim()
        .toLowerCase();
    if (!path) return '';
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return withLeadingSlash.length > 1
        ? withLeadingSlash.replace(/\/+$/, '')
        : withLeadingSlash;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const routePatternToRegex = (pattern = '') => {
    const normalizedPattern = normalizeRequestPath(pattern);
    if (!normalizedPattern) return /^$/;

    const parts = normalizedPattern.split('/').map((part) => {
        if (!part) return '';
        if (part.startsWith(':')) return '[^/]+';
        return escapeRegex(part);
    });

    return new RegExp(`^${parts.join('/')}/?$`, 'i');
};

const routePatternMatchesPath = (pattern = '', requestPath = '') => (
    routePatternToRegex(pattern).test(normalizeRequestPath(requestPath))
);

const resolveAuthorizationPolicy = ({
    method = '',
    path = '',
    policies = null,
} = {}) => {
    const requestMethod = normalizeMethod(method);
    const requestPath = normalizeRequestPath(path);
    if (!requestMethod || !requestPath) return null;

    const policyList = Array.isArray(policies) ? policies : listAuthorizationPolicy();
    return policyList.find((entry) => (
        normalizeMethod(entry?.method) === requestMethod
        && routePatternMatchesPath(entry?.path, requestPath)
    )) || null;
};

const isPrivilegedApprovalRequired = (permission = '', privilegedAccessPolicy = null) => {
    const policy = privilegedAccessPolicy || getPrivilegedAccessPolicy();
    if (!policy?.jitAccessEnabled || !permission) return false;
    const protectedPermissions = Array.isArray(policy.approvalRequiredFor)
        ? policy.approvalRequiredFor
        : [];

    return protectedPermissions.some((protectedPermission) => (
        permissionMatches(protectedPermission, permission)
    ));
};

const normalizeGrantList = (grants = []) => {
    if (Array.isArray(grants)) return grants;
    if (!grants || typeof grants !== 'object') return [];

    return Object.entries(grants).map(([permission, grant]) => (
        grant && typeof grant === 'object'
            ? { permission, ...grant }
            : { permission, active: Boolean(grant) }
    ));
};

const getGrantExpiryMillis = (grant = {}) => {
    const raw = grant.expiresAt || grant.expires_at || grant.expiry || grant.expires;
    if (!raw) return 0;
    if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const grantHasPermission = (grant = {}, permission = '') => {
    const candidates = [
        grant.permission,
        grant.action,
        ...(Array.isArray(grant.permissions) ? grant.permissions : []),
    ].filter(Boolean);

    return candidates.some((candidate) => permissionMatches(candidate, permission));
};

const findActivePrivilegedGrant = ({
    grants = [],
    permission = '',
    now = Date.now(),
} = {}) => normalizeGrantList(grants).find((grant) => {
    const status = normalize(grant.status);
    if (status) {
        if (!['approved', 'active'].includes(status)) return false;
    } else if (grant.active !== true) {
        return false;
    }
    if (!grantHasPermission(grant, permission)) return false;
    const expiresAtMs = getGrantExpiryMillis(grant);
    return expiresAtMs > now;
}) || null;

const buildDecision = ({
    allowed,
    reason,
    code,
    statusCode,
    message,
    policy,
    grant = null,
} = {}) => ({
    allowed: Boolean(allowed),
    reason,
    code,
    statusCode,
    message,
    policy: policy ? { ...policy } : null,
    permission: policy?.permission || '',
    role: policy?.role || '',
    assurance: policy?.assurance || '',
    jitRequired: code === 'PRIVILEGED_JIT_REQUIRED' || Boolean(grant),
    grantId: grant?.grantId || grant?.id || '',
});

const evaluateAuthorization = ({
    user = null,
    method = '',
    path = '',
    policy = null,
    policies = null,
    authSession = null,
    privilegedAccessPolicy = null,
    now = Date.now(),
} = {}) => {
    const matchedPolicy = policy || resolveAuthorizationPolicy({ method, path, policies });
    if (!matchedPolicy) {
        return buildDecision({
            allowed: true,
            reason: 'no_policy_match',
            code: 'NO_POLICY_MATCH',
            statusCode: 200,
            message: 'No authorization policy matched this route.',
        });
    }

    if (matchedPolicy.role && !hasRole(user, matchedPolicy.role)) {
        return buildDecision({
            allowed: false,
            reason: 'role_required',
            code: 'AUTHZ_ROLE_REQUIRED',
            statusCode: 403,
            message: 'Required role is missing',
            policy: matchedPolicy,
        });
    }

    if (matchedPolicy.permission && !hasPermission(user, matchedPolicy.permission)) {
        return buildDecision({
            allowed: false,
            reason: 'permission_required',
            code: 'AUTHZ_PERMISSION_REQUIRED',
            statusCode: 403,
            message: 'Required permission is missing',
            policy: matchedPolicy,
        });
    }

    if (isPrivilegedApprovalRequired(matchedPolicy.permission, privilegedAccessPolicy)) {
        const grant = findActivePrivilegedGrant({
            grants: authSession?.privilegedGrants || user?.privilegedGrants || [],
            permission: matchedPolicy.permission,
            now,
        });

        if (!grant) {
            return buildDecision({
                allowed: false,
                reason: 'jit_grant_required',
                code: 'PRIVILEGED_JIT_REQUIRED',
                statusCode: 403,
                message: 'Just-in-time privileged approval is required for this action',
                policy: matchedPolicy,
            });
        }

        return buildDecision({
            allowed: true,
            reason: 'jit_grant_satisfied',
            code: 'AUTHZ_ALLOWED',
            statusCode: 200,
            message: 'Authorization policy satisfied.',
            policy: matchedPolicy,
            grant,
        });
    }

    return buildDecision({
        allowed: true,
        reason: 'policy_satisfied',
        code: 'AUTHZ_ALLOWED',
        statusCode: 200,
        message: 'Authorization policy satisfied.',
        policy: matchedPolicy,
    });
};

const requireRole = (user = null, role = '') => {
    if (!hasRole(user, role)) {
        throw new AppError('Required role is missing', 403);
    }
    return true;
};

const requirePermission = (user = null, permission = '') => {
    if (!hasPermission(user, permission)) {
        throw new AppError('Required permission is missing', 403);
    }
    return true;
};

const requireOwnerOrPermission = ({
    user = null,
    ownerId = '',
    permission = '',
} = {}) => {
    const actorId = String(user?._id || user?.id || '').trim();
    if (actorId && ownerId && actorId === String(ownerId).trim()) {
        return true;
    }
    return requirePermission(user, permission);
};

const requireAuthorization = (options = {}) => {
    const decision = evaluateAuthorization(options);
    if (!decision.allowed) {
        const error = new AppError(decision.message || 'Authorization denied', decision.statusCode || 403);
        error.code = decision.code;
        error.authzDecision = decision;
        throw error;
    }
    return decision;
};

module.exports = {
    ROLE_PERMISSIONS,
    evaluateAuthorization,
    findActivePrivilegedGrant,
    getUserPermissions,
    getUserRoles,
    hasPermission,
    hasRole,
    isPrivilegedApprovalRequired,
    requireAuthorization,
    requireOwnerOrPermission,
    requirePermission,
    requireRole,
    resolveAuthorizationPolicy,
    __private: {
        permissionMatches,
        roleMatches,
        routePatternMatchesPath,
    },
};
