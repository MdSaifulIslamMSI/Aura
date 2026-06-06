const mongoose = require('mongoose');
const User = require('../../models/User');

const userIdFromRequest = (req = {}) => {
    const candidates = [
        req.params?.userId,
        req.params?.id,
        req.query?.userId,
        req.body?.userId,
        req.user?._id,
    ];
    return candidates
        .map((value) => String(value || '').trim())
        .find((value) => mongoose.isValidObjectId(value)) || '';
};

const loadUserResource = async (req = {}) => {
    const userId = userIdFromRequest(req);
    if (!userId) return null;
    const queryOrPromise = User.findById(userId);
    const user = typeof queryOrPromise?.select === 'function'
        ? await queryOrPromise
            .select('_id isAdmin adminRoles isSeller accountState softDeleted')
            .lean()
        : await queryOrPromise;
    if (!user) return null;

    return {
        _id: user._id,
        id: String(user._id),
        type: 'user',
        resourceType: 'user',
        ownerId: String(user._id),
        userId: String(user._id),
        state: user.softDeleted ? 'deleted' : user.accountState || 'active',
        isAdmin: Boolean(user.isAdmin),
        adminRoles: user.adminRoles || [],
        isSeller: Boolean(user.isSeller),
    };
};

module.exports = {
    loadUserResource,
};
