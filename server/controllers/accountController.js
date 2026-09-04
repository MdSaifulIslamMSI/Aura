const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { buildAccountOverview } = require('../services/accountOverviewService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');

const getAccountOverview = asyncHandler(async (req, res, next) => {
    const userId = String(req.user?._id || '').trim();
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    try {
        const overview = await buildAccountOverview(userId);
        res.set('Cache-Control', 'private, no-store');
        res.set('Vary', 'Authorization, Cookie');
        recordAuthSecurityEvent({
            event: 'account.overview.viewed',
            outcome: 'success',
            reason: 'user_requested',
            surface: 'account_profile',
            req,
        });
        return res.status(200).json(overview);
    } catch (error) {
        if (error?.code === 'ACCOUNT_PROFILE_NOT_FOUND') {
            return next(new AppError('Account profile not found', 404));
        }
        throw error;
    }
});

module.exports = {
    getAccountOverview,
};
