const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { flags: assistantFlags } = require('../config/assistantFlags');
const { createAssistantTurn } = require('../services/assistantV2/assistantService');

const handleAssistantTurn = asyncHandler(async (req, res, next) => {
    if (!assistantFlags.assistantV2Enabled) {
        return next(new AppError('Assistant v2 is disabled', 404));
    }

    const message = req.body?.message;
    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    const response = await createAssistantTurn({
        sessionId: req.body?.sessionId || '',
        message,
        routeContext: req.body?.routeContext || {},
        commerceContext: req.body?.commerceContext || {},
        userContext: req.body?.userContext || {},
        reqUser: req.user || null,
    });

    return res.json(response);
});

module.exports = {
    handleAssistantTurn,
};
