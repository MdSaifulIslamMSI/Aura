const crypto = require('crypto');
const PrivilegedAccessGrant = require('../../models/PrivilegedAccessGrant');
const { getPrivilegedAccessPolicy } = require('../../config/privilegedAccessPolicy');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

const GRANT_STATUS = Object.freeze(['pending', 'approved', 'denied', 'revoked', 'expired']);

const assertPermissionEligible = (permission) => {
    const policy = getPrivilegedAccessPolicy();
    const eligible = String(permission || '').trim();
    if (!policy.approvalRequiredFor.includes(eligible)) {
        throw new AppError('Permission is not eligible for privileged JIT approval', 400, 'PRIVILEGED_PERMISSION_NOT_ELIGIBLE');
    }
    return eligible;
};

const audit = (event, fields = {}) => {
    logger.info(event, fields);
};

const expireDueGrants = async (subjectUserId = null) => {
    const now = new Date();
    const filter = { status: 'approved', expiresAt: { $ne: null, $lte: now } };
    if (subjectUserId) filter.subjectUser = subjectUserId;
    const result = await PrivilegedAccessGrant.updateMany(filter, { $set: { status: 'expired' } });
    if (result?.modifiedCount > 0) {
        audit('privileged_access.expired', { count: result.modifiedCount, subjectUser: subjectUserId ? String(subjectUserId) : null });
    }
    return result?.modifiedCount || 0;
};

const requestGrant = async ({ subjectUser, permission, reason, requestId = '' }) => {
    const eligiblePermission = assertPermissionEligible(permission);

    const now = new Date();
    const duplicate = await PrivilegedAccessGrant.findOne({
        subjectUser,
        permission: eligiblePermission,
        $or: [
            { status: 'pending' },
            { status: 'approved', expiresAt: { $gt: now } },
        ],
    }).lean();
    if (duplicate) {
        throw new AppError('An active or pending grant already exists for this permission', 409, 'PRIVILEGED_GRANT_ALREADY_ACTIVE');
    }

    const grant = await PrivilegedAccessGrant.create({
        grantId: `jit_${crypto.randomUUID()}`,
        subjectUser,
        permission: eligiblePermission,
        status: 'pending',
        reason: String(reason || '').trim(),
        requestedBy: subjectUser,
    });

    audit('privileged_access.requested', {
        requestId,
        grantId: grant.grantId,
        subjectUser: String(subjectUser),
        permission: grant.permission,
        reason: grant.reason,
    });
    return grant;
};

const approveGrant = async ({ grantId, approverUser, requestId = '' }) => {
    const grant = await PrivilegedAccessGrant.findOne({ grantId });
    if (!grant) {
        throw new AppError('Privileged access grant not found', 404, 'PRIVILEGED_GRANT_NOT_FOUND');
    }
    if (grant.status !== 'pending') {
        throw new AppError(`Grant is not pending (current status: ${grant.status})`, 409, 'PRIVILEGED_GRANT_NOT_PENDING');
    }
    if (String(grant.requestedBy) === String(approverUser?._id)) {
        throw new AppError('Self-approval of privileged access is not allowed', 403, 'PRIVILEGED_SELF_APPROVAL_DENIED');
    }

    const ttlMinutes = Number(getPrivilegedAccessPolicy().defaultGrantTtlMinutes) || 30;
    grant.status = 'approved';
    grant.approvedBy = approverUser?._id;
    grant.approvedAt = new Date();
    grant.expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await grant.save();

    audit('privileged_access.approved', {
        requestId,
        grantId: grant.grantId,
        subjectUser: String(grant.subjectUser),
        approverUser: String(approverUser?._id || ''),
        permission: grant.permission,
        expiresAt: grant.expiresAt.toISOString(),
    });
    return grant;
};

const denyGrant = async ({ grantId, approverUser, reason = '', requestId = '' }) => {
    const grant = await PrivilegedAccessGrant.findOne({ grantId });
    if (!grant) {
        throw new AppError('Privileged access grant not found', 404, 'PRIVILEGED_GRANT_NOT_FOUND');
    }
    if (grant.status !== 'pending') {
        throw new AppError(`Grant is not pending (current status: ${grant.status})`, 409, 'PRIVILEGED_GRANT_NOT_PENDING');
    }

    grant.status = 'denied';
    grant.deniedBy = approverUser?._id;
    grant.deniedAt = new Date();
    grant.deniedReason = String(reason || '').trim();
    await grant.save();

    audit('privileged_access.denied', {
        requestId,
        grantId: grant.grantId,
        subjectUser: String(grant.subjectUser),
        approverUser: String(approverUser?._id || ''),
        permission: grant.permission,
        reason: grant.deniedReason,
    });
    return grant;
};

const revokeGrant = async ({ grantId, approverUser, requestId = '' }) => {
    const grant = await PrivilegedAccessGrant.findOne({ grantId });
    if (!grant) {
        throw new AppError('Privileged access grant not found', 404, 'PRIVILEGED_GRANT_NOT_FOUND');
    }
    if (grant.status !== 'approved') {
        throw new AppError(`Only approved grants can be revoked (current status: ${grant.status})`, 409, 'PRIVILEGED_GRANT_NOT_ACTIVE');
    }

    grant.status = 'revoked';
    grant.revokedBy = approverUser?._id;
    grant.revokedAt = new Date();
    await grant.save();

    audit('privileged_access.revoked', {
        requestId,
        grantId: grant.grantId,
        subjectUser: String(grant.subjectUser),
        approverUser: String(approverUser?._id || ''),
        permission: grant.permission,
    });
    return grant;
};

const getActiveGrantsForUser = async (subjectUserId) => {
    if (!subjectUserId) return [];
    await expireDueGrants(subjectUserId);
    return PrivilegedAccessGrant
        .find({ subjectUser: subjectUserId, status: 'approved', expiresAt: { $gt: new Date() } })
        .select('grantId permission expiresAt status')
        .lean();
};

const listGrants = async ({ status = null, subjectUserId = null, limit = 50 } = {}) => {
    await expireDueGrants();
    const filter = {};
    if (status) filter.status = status;
    if (subjectUserId) filter.subjectUser = subjectUserId;
    const items = await PrivilegedAccessGrant
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit) || 50, 200))
        .lean();
    return { items, total: items.length };
};

module.exports = {
    GRANT_STATUS,
    assertPermissionEligible,
    requestGrant,
    approveGrant,
    denyGrant,
    revokeGrant,
    getActiveGrantsForUser,
    listGrants,
    expireDueGrants,
};
