const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    parseExpectedVersion,
    getCartSnapshot,
    applyCartCommands,
} = require('../services/cartService');
const { emitCartRealtimeUpdate } = require('../services/cartRealtimeService');

const getCanonicalCart = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    const cart = await getCartSnapshot({
        userId,
        user: req.user,
        market: req.market,
    });

    return res.json(cart);
});

const applyCanonicalCartCommands = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const clientMutationId = String(req.body?.clientMutationId || '').trim();
    const commands = req.body?.commands;

    if (!Array.isArray(commands) || commands.length === 0) {
        return next(new AppError('commands must be a non-empty array', 400));
    }

    const result = await applyCartCommands({
        userId,
        user: req.user,
        expectedVersion,
        clientMutationId,
        commands,
        market: req.market,
    });

    if (result.conflict) {
        return res.status(409).json({
            code: 'cart_version_conflict',
            message: 'Cart version conflict',
            cart: result.cart,
        });
    }

    emitCartRealtimeUpdate({
        socketUserId: req.user?._id,
        authUid: req.authUid,
        cart: result.cart,
        reason: 'cart_commands_applied',
        requestId: req.requestId,
        source: 'cart_controller',
    });

    return res.json({
        cart: result.cart,
        appliedMutationId: result.appliedMutationId || clientMutationId,
    });
});

module.exports = {
    getCanonicalCart,
    applyCanonicalCartCommands,
};
