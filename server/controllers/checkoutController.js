const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { getCheckoutConfig } = require('../services/checkoutConfigService');

const getCheckoutRuntimeConfig = asyncHandler(async (req, res, next) => {
    try {
        const config = await getCheckoutConfig({
            market: req.market,
            userId: req.user?._id || null,
        });
        return res.json(config);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to resolve checkout config', 500));
    }
});

module.exports = {
    getCheckoutRuntimeConfig,
};
