const REQUIRED_POLICY_ENV = Object.freeze([
    'ACCOUNT_PRIVACY_POLICY_VERSION',
    'ACCOUNT_PRIVACY_JURISDICTIONS',
    'ACCOUNT_PRIVACY_EXPORT_RETENTION_DAYS',
    'ACCOUNT_PRIVACY_DELETION_GRACE_DAYS',
    'ACCOUNT_PRIVACY_REACTIVATION_POLICY',
    'ACCOUNT_PRIVACY_EXPORT_DELIVERY',
    'AWS_S3_PRIVACY_BUCKET',
    'ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID',
]);

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
);

const getMissingPolicyConfiguration = () => REQUIRED_POLICY_ENV.filter(
    (key) => !String(process.env[key] || '').trim()
);

const getPrivacyPolicySnapshot = () => ({
    version: String(process.env.ACCOUNT_PRIVACY_POLICY_VERSION || '').trim(),
    jurisdictions: String(process.env.ACCOUNT_PRIVACY_JURISDICTIONS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    exportRetentionDays: Number(process.env.ACCOUNT_PRIVACY_EXPORT_RETENTION_DAYS || 0),
    deletionGraceDays: Number(process.env.ACCOUNT_PRIVACY_DELETION_GRACE_DAYS || 0),
    reactivationPolicy: String(process.env.ACCOUNT_PRIVACY_REACTIVATION_POLICY || '').trim(),
    exportDelivery: String(process.env.ACCOUNT_PRIVACY_EXPORT_DELIVERY || '').trim(),
});

const getAccountPrivacyActivation = () => {
    const flagEnabled = isTruthy(process.env.ACCOUNT_CENTER_V2_PRIVACY);
    const policyApproved = isTruthy(process.env.ACCOUNT_PRIVACY_POLICY_APPROVED);
    const missingConfiguration = getMissingPolicyConfiguration();
    const snapshot = getPrivacyPolicySnapshot();
    const numericPolicyValid = Number.isInteger(snapshot.exportRetentionDays)
        && snapshot.exportRetentionDays > 0
        && Number.isInteger(snapshot.deletionGraceDays)
        && snapshot.deletionGraceDays > 0;
    const enabled = flagEnabled
        && policyApproved
        && missingConfiguration.length === 0
        && numericPolicyValid;

    return {
        enabled,
        flagEnabled,
        policyApproved,
        policyVersion: snapshot.version || null,
        blockedReason: enabled ? null : 'authoritative_policy_or_runtime_contract_incomplete',
        missingConfigurationCount: missingConfiguration.length + (numericPolicyValid ? 0 : 1),
        policy: enabled ? snapshot : null,
    };
};

module.exports = {
    REQUIRED_POLICY_ENV,
    getAccountPrivacyActivation,
    getMissingPolicyConfiguration,
    getPrivacyPolicySnapshot,
};
