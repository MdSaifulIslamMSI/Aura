const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.join(__dirname, '..', '..', 'config', 'security', 'post-quantum-policy.json');

const trim = (value) => String(value || '').trim();
const currentNodeEnv = () => trim(process.env.NODE_ENV).toLowerCase();

const fallbackPolicy = {
    policyVersion: 'unavailable',
    minimumTlsVersion: 'TLSv1.3',
    preferredHybridKeyExchange: [],
    allowedSymmetricCrypto: [],
    allowedPasswordHashing: [],
    forbiddenNewCrypto: [],
    warningCrypto: [],
    deploymentProof: {
        sshHybridKexPreferred: false,
        tls13RequiredWhereAppControlled: true,
        openssl35NativePqcPreferred: true,
        oqsProviderLabOnly: true,
        providerControlledSurfacesTracked: true,
    },
    controlledSurfaces: {},
};

const assertStringArray = (policy, key) => {
    if (!Array.isArray(policy[key]) || policy[key].some((entry) => !trim(entry))) {
        throw new Error(`PQC crypto policy field ${key} must be a non-empty string array`);
    }
};

const assertObject = (policy, key) => {
    if (!policy[key] || typeof policy[key] !== 'object' || Array.isArray(policy[key])) {
        throw new Error(`PQC crypto policy field ${key} must be an object`);
    }
};

const assertBooleanObjectFields = (policy, key, fields) => {
    assertObject(policy, key);
    fields.forEach((field) => {
        if (typeof policy[key][field] !== 'boolean') {
            throw new Error(`PQC crypto policy field ${key}.${field} must be boolean`);
        }
    });
};

const assertStringObjectValues = (policy, key, requiredKeys) => {
    assertObject(policy, key);
    requiredKeys.forEach((field) => {
        if (!trim(policy[key][field])) {
            throw new Error(`PQC crypto policy field ${key}.${field} must be a non-empty string`);
        }
    });
};

const validateCryptoPolicy = (policy) => {
    if (!policy || typeof policy !== 'object') {
        throw new Error('PQC crypto policy must be an object');
    }
    if (!trim(policy.policyVersion)) {
        throw new Error('PQC crypto policy requires policyVersion');
    }
    if (trim(policy.minimumTlsVersion) !== 'TLSv1.3') {
        throw new Error('PQC crypto policy minimumTlsVersion must be TLSv1.3');
    }

    [
        'preferredHybridKeyExchange',
        'allowedSymmetricCrypto',
        'allowedPasswordHashing',
        'forbiddenNewCrypto',
        'warningCrypto',
    ].forEach((key) => assertStringArray(policy, key));

    assertBooleanObjectFields(policy, 'deploymentProof', [
        'sshHybridKexPreferred',
        'tls13RequiredWhereAppControlled',
        'openssl35NativePqcPreferred',
        'oqsProviderLabOnly',
        'providerControlledSurfacesTracked',
    ]);

    assertStringObjectValues(policy, 'controlledSurfaces', [
        'ssh',
        'tlsEdge',
        'internalServices',
        'backups',
        'releaseSigning',
    ]);

    return policy;
};

const projectPolicyView = (policy) => ({
    policyVersion: policy.policyVersion,
    minimumTlsVersion: policy.minimumTlsVersion,
    preferredHybridKeyExchange: policy.preferredHybridKeyExchange,
    allowedSymmetricCrypto: policy.allowedSymmetricCrypto,
    allowedPasswordHashing: policy.allowedPasswordHashing,
    forbiddenNewCrypto: policy.forbiddenNewCrypto,
    warningCrypto: policy.warningCrypto,
    deploymentProof: policy.deploymentProof,
    controlledSurfaces: policy.controlledSurfaces,
});

const loadCryptoPolicy = (options = {}) => {
    const policyPath = options.policyPath || POLICY_PATH;
    const nodeEnv = currentNodeEnv();
    const isProduction = nodeEnv === 'production';
    const logger = options.logger || console;

    try {
        const rawPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
        return projectPolicyView(validateCryptoPolicy(rawPolicy));
    } catch (error) {
        if (isProduction && options.strict !== true) {
            logger.warn('crypto_policy.load_failed', {
                policyPath,
                reason: error.message,
                fallback: 'TLSv1.3-only safe defaults',
            });
            return { ...fallbackPolicy };
        }
        throw error;
    }
};

module.exports = {
    POLICY_PATH,
    loadCryptoPolicy,
    validateCryptoPolicy,
};
