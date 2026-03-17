const logger = require('../utils/logger');
const normalizeEnv = (value) => String(value || '').trim().toLowerCase();

const requireSecret = (envVarName, isStrict) => {
    const value = String(process.env[envVarName] || '').trim();
    if (!value) {
        const msg = `CRITICAL: ${envVarName} is missing. Please add it to your Render Environment Variables (or .env file).`;
        if (isStrict) {
            throw new Error(msg);
        } else {
            logger.warn('config.missing_secret', { secret: envVarName, tip: 'Set this in .env for production parity' });
        }
    }
};

const assertSigningSecretsConfig = () => {
    const nodeEnv = normalizeEnv(process.env.NODE_ENV || 'development');
    if (nodeEnv === 'test') return;

    const isProduction = nodeEnv === 'production';
    requireSecret('OTP_FLOW_SECRET', isProduction);
    requireSecret('OTP_CHALLENGE_SECRET', isProduction);
    requireSecret('UPLOAD_SIGNING_SECRET', isProduction);
};

module.exports = {
    assertSigningSecretsConfig,
};
