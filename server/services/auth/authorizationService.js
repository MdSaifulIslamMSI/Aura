const AppError = require('../../utils/AppError');

const ROLE_ALIASES = new Map([
    ['admin', ['admin', 'ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN']],
    ['support', ['support', 'SUPPORT', 'SECURITY_ADMIN', 'ADMIN', 'SUPER_ADMIN']],
    ['seller', ['seller']],
    ['service', ['service', 'SERVICE']],
    ['user', ['user']],
]);

const ROLE_PERMISSIONS = {
    user: ['profile:read', 'profile:update', 'order:read:self'],
    seller: ['listing:manage:self', 'order:read:seller'],
    support: ['support:read', 'support:update', 'user:read:support'],
    admin: ['admin:*', 'user:*', 'catalog:*', 'order:*', 'payment:*'],
    service: ['service:*'],
};

const normalize = (value = '') => String(value || '').trim().toLowerCase();

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
    const candidate = normalize(candidatePermission);
    const required = normalize(requiredPermission);
    if (!candidate || !required) return false;
    if (candidate === required) return true;
    if (candidate.endsWith(':*')) {
        return required.startsWith(candidate.slice(0, -1));
    }
    if (candidate.endsWith('*')) {
        return required.startsWith(candidate.slice(0, -1));
    }
    return false;
};

const hasPermission = (user = null, requiredPermission = '') => getUserPermissions(user)
    .some((permission) => permissionMatches(permission, requiredPermission));

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

module.exports = {
    ROLE_PERMISSIONS,
    getUserPermissions,
    getUserRoles,
    hasPermission,
    hasRole,
    requireOwnerOrPermission,
    requirePermission,
    requireRole,
    __private: {
        permissionMatches,
        roleMatches,
    },
};
