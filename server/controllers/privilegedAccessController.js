const asyncHandler = require('express-async-handler');
const {
    requestGrant,
    approveGrant,
    denyGrant,
    revokeGrant,
    listGrants,
} = require('../services/auth/privilegedAccessGrantService');

const serializeGrant = (grant = {}) => ({
    grantId: grant.grantId,
    subjectUser: grant.subjectUser ? String(grant.subjectUser) : null,
    permission: grant.permission,
    status: grant.status,
    reason: grant.reason || '',
    requestedBy: grant.requestedBy ? String(grant.requestedBy) : null,
    approvedBy: grant.approvedBy ? String(grant.approvedBy) : null,
    approvedAt: grant.approvedAt || null,
    deniedAt: grant.deniedAt || null,
    revokedAt: grant.revokedAt || null,
    expiresAt: grant.expiresAt || null,
    createdAt: grant.createdAt || null,
});

const requestPrivilegedAccess = asyncHandler(async (req, res, next) => {
    try {
        const grant = await requestGrant({
            subjectUser: req.user._id,
            permission: req.body.permission,
            reason: req.body.reason,
            requestId: req.requestId || '',
        });
        return res.status(202).json({ success: true, grant: serializeGrant(grant) });
    } catch (error) {
        return next(error);
    }
});

const listPrivilegedAccessGrants = asyncHandler(async (req, res, next) => {
    try {
        const { items } = await listGrants({
            status: req.query.status || null,
            limit: req.query.limit || 50,
        });
        return res.json({ success: true, total: items.length, items: items.map(serializeGrant) });
    } catch (error) {
        return next(error);
    }
});

const approvePrivilegedAccessGrant = asyncHandler(async (req, res, next) => {
    try {
        const grant = await approveGrant({
            grantId: req.params.grantId,
            approverUser: req.user,
            requestId: req.requestId || '',
        });
        return res.json({ success: true, grant: serializeGrant(grant) });
    } catch (error) {
        return next(error);
    }
});

const denyPrivilegedAccessGrant = asyncHandler(async (req, res, next) => {
    try {
        const grant = await denyGrant({
            grantId: req.params.grantId,
            approverUser: req.user,
            reason: req.body.reason,
            requestId: req.requestId || '',
        });
        return res.json({ success: true, grant: serializeGrant(grant) });
    } catch (error) {
        return next(error);
    }
});

const revokePrivilegedAccessGrant = asyncHandler(async (req, res, next) => {
    try {
        const grant = await revokeGrant({
            grantId: req.params.grantId,
            approverUser: req.user,
            requestId: req.requestId || '',
        });
        return res.json({ success: true, grant: serializeGrant(grant) });
    } catch (error) {
        return next(error);
    }
});

module.exports = {
    requestPrivilegedAccess,
    listPrivilegedAccessGrants,
    approvePrivilegedAccessGrant,
    denyPrivilegedAccessGrant,
    revokePrivilegedAccessGrant,
};
