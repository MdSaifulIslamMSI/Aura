const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { buildAccountMarketplaceHub } = require('../services/accountMarketplaceService');

const getAccountMarketplace = asyncHandler(async (req, res, next) => {
    const userId = String(req.user?._id || '').trim();
    if (!userId) return next(new AppError('Not authorized', 401));

    try {
        const marketplace = await buildAccountMarketplaceHub(userId);
        res.set('Cache-Control', 'private, no-store');
        res.set('Vary', 'Authorization, Cookie');
        return res.status(200).json(marketplace);
    } catch (error) {
        if (error?.code === 'ACCOUNT_PROFILE_NOT_FOUND') {
            return next(new AppError('Account profile not found', 404));
        }
        throw error;
    }
});

module.exports = {
    getAccountMarketplace,
};
