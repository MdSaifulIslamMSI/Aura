const normalizeEnv = (value) => String(value || '').trim().toLowerCase();

const requireSecret = (envVarName) => {
    const value = String(process.env[envVarName] || '').trim();
    if (!value) {
        throw new Error(`${envVarName} is required when NODE_ENV is not "test"`);
    }
};

const assertSigningSecretsConfig = () => {
    const nodeEnv = normalizeEnv(process.env.NODE_ENV || 'development');
    if (nodeEnv === 'test') return;

    requireSecret('OTP_FLOW_SECRET');
    requireSecret('UPLOAD_SIGNING_SECRET');
};

module.exports = {
    assertSigningSecretsConfig,
};
