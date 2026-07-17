const {
    getTrustedDeviceV2CohortBucket,
    getTrustedDeviceV2RolloutConfig,
    isTrustedDeviceV2SubjectSelected,
} = require('../config/trustedDeviceV2Rollout');

describe('trusted-device V2 rollout config', () => {
    test('defaults to legacy reads, disabled writes, and empty cohorts', () => {
        expect(getTrustedDeviceV2RolloutConfig({})).toEqual({
            writeMode: 'off',
            readMode: 'legacy',
            adminCohortPercent: 0,
            publicCohortPercent: 0,
            allowlist: [],
            cohortSeed: 'trusted-device-v2-default',
        });
    });

    test('parses shadow mode, independent cohorts, and a normalized allowlist', () => {
        const config = getTrustedDeviceV2RolloutConfig({
            AUTH_TRUSTED_DEVICE_V2_WRITE_MODE: 'DUAL_WRITE',
            AUTH_TRUSTED_DEVICE_V2_READ_MODE: 'SHADOW_COMPARE',
            AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT: '10',
            AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT: '25',
            AUTH_TRUSTED_DEVICE_V2_ALLOWLIST: ' User-B, user-a, USER-B ',
            AUTH_TRUSTED_DEVICE_V2_COHORT_SEED: 'release-2026-07',
        });

        expect(config).toEqual({
            writeMode: 'dual_write',
            readMode: 'shadow_compare',
            adminCohortPercent: 10,
            publicCohortPercent: 25,
            allowlist: ['user-a', 'user-b'],
            cohortSeed: 'release-2026-07',
        });
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.allowlist)).toBe(true);
    });

    test.each([
        [{ AUTH_TRUSTED_DEVICE_V2_WRITE_MODE: 'write_everywhere' }, 'AUTH_TRUSTED_DEVICE_V2_WRITE_MODE'],
        [{ AUTH_TRUSTED_DEVICE_V2_READ_MODE: 'prefer_v2' }, 'AUTH_TRUSTED_DEVICE_V2_READ_MODE'],
        [{ AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT: '-1' }, 'AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT'],
        [{ AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT: '100.5' }, 'AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT'],
    ])('rejects invalid configuration instead of silently widening rollout', (env, key) => {
        expect(() => getTrustedDeviceV2RolloutConfig(env)).toThrow(key);
    });

    test.each(['v2_with_legacy_fallback', 'v2_only'])(
        'rejects reserved authoritative read mode %s until atomic cutover exists',
        (readMode) => {
            expect(() => getTrustedDeviceV2RolloutConfig({
                AUTH_TRUSTED_DEVICE_V2_WRITE_MODE: 'dual_write',
                AUTH_TRUSTED_DEVICE_V2_READ_MODE: readMode,
            })).toThrow('reserved until the atomic V2 cutover path');
        }
    );

    test('selects deterministic, audience-separated cohorts', () => {
        const config = getTrustedDeviceV2RolloutConfig({
            AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT: '100',
            AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT: '0',
        });

        expect(isTrustedDeviceV2SubjectSelected({
            subjectId: 'subject-123',
            audience: 'admin',
            config,
        })).toBe(true);
        expect(isTrustedDeviceV2SubjectSelected({
            subjectId: 'subject-123',
            audience: 'public',
            config,
        })).toBe(false);

        const first = getTrustedDeviceV2CohortBucket({
            subjectId: 'subject-123',
            audience: 'public',
            cohortSeed: config.cohortSeed,
        });
        const second = getTrustedDeviceV2CohortBucket({
            subjectId: 'SUBJECT-123',
            audience: 'public',
            cohortSeed: config.cohortSeed,
        });
        expect(first).toBe(second);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(100);
    });

    test('allowlist selection is explicit and overrides a zero-percent cohort', () => {
        const config = getTrustedDeviceV2RolloutConfig({
            AUTH_TRUSTED_DEVICE_V2_ALLOWLIST: 'allowed-subject',
        });

        expect(isTrustedDeviceV2SubjectSelected({
            subjectId: 'ALLOWED-SUBJECT',
            audience: 'public',
            config,
        })).toBe(true);
        expect(isTrustedDeviceV2SubjectSelected({
            subjectId: 'other-subject',
            audience: 'public',
            config,
        })).toBe(false);
    });

    test('rejects an unknown audience even when the subject is allowlisted', () => {
        const config = getTrustedDeviceV2RolloutConfig({
            AUTH_TRUSTED_DEVICE_V2_ALLOWLIST: 'allowed-subject',
        });

        expect(() => isTrustedDeviceV2SubjectSelected({
            subjectId: 'allowed-subject',
            audience: 'operator',
            config,
        })).toThrow('audience must be one of');
    });
});
