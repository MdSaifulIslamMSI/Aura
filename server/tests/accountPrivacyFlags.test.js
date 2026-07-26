const ORIGINAL_ENV = { ...process.env };

const enableCompletePolicy = () => {
    process.env.ACCOUNT_CENTER_V2_PRIVACY = 'true';
    process.env.ACCOUNT_PRIVACY_POLICY_APPROVED = 'true';
    process.env.ACCOUNT_PRIVACY_POLICY_VERSION = 'policy-2026-07';
    process.env.ACCOUNT_PRIVACY_JURISDICTIONS = 'IN';
    process.env.ACCOUNT_PRIVACY_EXPORT_RETENTION_DAYS = '7';
    process.env.ACCOUNT_PRIVACY_DELETION_GRACE_DAYS = '30';
    process.env.ACCOUNT_PRIVACY_REACTIVATION_POLICY = 'during-grace';
    process.env.ACCOUNT_PRIVACY_EXPORT_DELIVERY = 'authenticated-download';
    process.env.AWS_S3_PRIVACY_BUCKET = 'privacy-artifacts';
    process.env.ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID = 'alias/privacy-export';
};

describe('account privacy activation', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    test('is disabled by default without inventing policy', () => {
        delete process.env.ACCOUNT_CENTER_V2_PRIVACY;
        delete process.env.ACCOUNT_PRIVACY_POLICY_APPROVED;
        const { getAccountPrivacyActivation } = require('../config/accountPrivacyFlags');

        expect(getAccountPrivacyActivation()).toMatchObject({
            enabled: false,
            blockedReason: 'authoritative_policy_or_runtime_contract_incomplete',
            policy: null,
        });
    });

    test('enables only with explicit approval and every runtime contract', () => {
        enableCompletePolicy();
        const { getAccountPrivacyActivation } = require('../config/accountPrivacyFlags');

        expect(getAccountPrivacyActivation()).toMatchObject({
            enabled: true,
            policyApproved: true,
            policyVersion: 'policy-2026-07',
            policy: {
                jurisdictions: ['IN'],
                exportRetentionDays: 7,
                deletionGraceDays: 30,
            },
        });
    });
});
