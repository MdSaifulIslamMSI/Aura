const {
    createVoiceSessionConfig,
    getCapabilitySnapshot,
    synthesizeSpeech,
} = require('./providerRegistry');
const { processRecoveredAssistantTurn } = require('./assistantRecoveryService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const normalizeHistory = (conversationHistory = []) => (
    Array.isArray(conversationHistory)
        ? conversationHistory
            .slice(-8)
            .map((entry) => ({
                role: safeString(entry?.role || 'user'),
                content: safeString(entry?.content || ''),
            }))
            .filter((entry) => entry.content)
        : []
);

const processAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    images = [],
}) => {
    const startedAt = Date.now();

    const recovered = await processRecoveredAssistantTurn({
        user,
        message,
        conversationHistory: normalizeHistory(conversationHistory),
        assistantMode,
        context,
        images,
    });

    return {
        ...recovered,
        providerCapabilities: getCapabilitySnapshot(),
        latencyMs: Date.now() - startedAt,
        safetyFlags: Array.isArray(recovered?.assistantTurn?.safetyFlags)
            ? recovered.assistantTurn.safetyFlags
            : [],
    };
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
