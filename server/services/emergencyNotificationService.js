const logger = require('../utils/logger');

const notifyEmergencyFlagChanged = async ({
    flagKey = '',
    action = '',
    actor = '',
    reason = '',
} = {}) => {
    try {
        logger.info('emergency.notification.placeholder', {
            flagKey,
            action,
            actor: actor || 'unknown',
            reasonPresent: Boolean(String(reason || '').trim()),
        });
    } catch (error) {
        logger.warn('emergency.notification.failed', {
            flagKey,
            action,
            error: error?.message || 'unknown',
        });
    }
};

module.exports = {
    notifyEmergencyFlagChanged,
};
