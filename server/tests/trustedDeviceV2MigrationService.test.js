const {
    MIGRATION_TRANSFORM_VERSION,
    buildAuditApprovalHash,
    buildCredentialUpsertOperations,
    runTrustedDeviceV2Migration,
    transformLegacyTrustedDevice,
} = require('../services/trustedDeviceV2MigrationService');

const PSEUDONYM_KEY = 'migration-test-pseudonym-key-0123456789abcdef';
const BASE_TIME = new Date('2026-07-17T10:00:00.000Z');

const clone = (value) => structuredClone(value);

const buildDevice = ({
    deviceId = 'device-public-0001',
    method = 'browser_key',
    credentialId = '',
    label = 'Home browser',
    backupObserved = false,
} = {}) => ({
    deviceId,
    label,
    method,
    algorithm: method === 'webauthn' ? 'WEBAUTHN-ES256' : 'RSA-PSS-SHA256',
    publicKeySpkiBase64: `public-key-${deviceId}`,
    webauthnCredentialIdBase64Url: credentialId,
    webauthnUserVerification: method === 'webauthn' ? 'required' : '',
    webauthnBackupEligible: backupObserved,
    webauthnBackedUp: backupObserved,
    webauthnBackupStateObservedAt: backupObserved
        ? new Date('2026-07-16T08:00:00.000Z')
        : null,
    sessionVersion: `session-${deviceId}`,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    lastVerifiedAt: new Date('2026-07-16T08:00:00.000Z'),
    revokedAt: null,
});

const buildUsers = () => ([
    {
        _id: '507f1f77bcf86cd799439011',
        isAdmin: false,
        adminRoles: [],
        trustedDevices: [buildDevice()],
    },
    {
        _id: '507f1f77bcf86cd799439012',
        isAdmin: true,
        adminRoles: ['ADMIN'],
        trustedDevices: [buildDevice({
            deviceId: 'device-admin-0001',
            method: 'webauthn',
            credentialId: 'admin-credential-0001',
            label: 'Admin passkey',
            backupObserved: true,
        })],
    },
]);

const createClock = () => {
    let tick = 0;
    return () => new Date(BASE_TIME.getTime() + (tick++ * 1000));
};

const createInMemoryStore = (sourceUsers = buildUsers()) => {
    const state = {
        runs: new Map(),
        sourceUsers: clone(sourceUsers),
        credentials: [],
        rejectLease: false,
    };
    let runSequence = 0;

    const store = {
        async getRun(runId) {
            const run = state.runs.get(runId);
            return run ? clone(run) : null;
        },
        async createRun(document) {
            if (state.runs.has(document.runId)) return clone(state.runs.get(document.runId));
            runSequence += 1;
            const run = {
                _id: String(runSequence).padStart(24, '0'),
                schemaVersion: 2,
                ...clone(document),
                lock: {},
                startedAt: null,
                finishedAt: null,
            };
            state.runs.set(run.runId, run);
            return clone(run);
        },
        async acquireLease({ runId, ownerHash, now, leaseExpiresAt, startedAt }) {
            if (state.rejectLease) return null;
            const run = state.runs.get(runId);
            if (!run || !['planned', 'running', 'paused'].includes(run.status)) return null;
            if (
                run.lock?.ownerHash
                && run.lock.ownerHash !== ownerHash
                && run.lock.leaseExpiresAt
                && new Date(run.lock.leaseExpiresAt).getTime() > now.getTime()
            ) {
                return null;
            }
            Object.assign(run, {
                status: 'running',
                startedAt,
                heartbeatAt: now,
                lock: { ownerHash, acquiredAt: now, leaseExpiresAt },
            });
            return clone(run);
        },
        async listSourceUsers({ audience, afterUserId, limit }) {
            return clone(state.sourceUsers
                .filter((user) => {
                    const isAdmin = Boolean(user.isAdmin || user.adminRoles?.length);
                    if (audience === 'admin' && !isAdmin) return false;
                    if (audience === 'public' && isAdmin) return false;
                    return !afterUserId || String(user._id) > String(afterUserId);
                })
                .sort((left, right) => String(left._id).localeCompare(String(right._id)))
                .slice(0, limit));
        },
        async upsertCredentials(records) {
            records.forEach((record) => {
                const existing = state.credentials.find((candidate) => (
                    String(candidate.user) === String(record.user)
                    && candidate.deviceIdHash === record.deviceIdHash
                ));
                if (!existing) state.credentials.push(clone(record));
            });
            return { successfulCount: records.length, failures: [] };
        },
        async saveProgress({ runId, ownerHash, checkpoint, totals, errorSample, now, leaseExpiresAt }) {
            const run = state.runs.get(runId);
            if (!run || run.status !== 'running' || run.lock?.ownerHash !== ownerHash) return null;
            Object.assign(run, {
                checkpoint: clone(checkpoint),
                totals: clone(totals),
                errorSample: clone(errorSample),
                heartbeatAt: now,
                lock: { ...run.lock, leaseExpiresAt },
            });
            return clone(run);
        },
        async finishRun({ runId, ownerHash, status, totals, errorSample, now }) {
            const run = state.runs.get(runId);
            if (!run || run.status !== 'running' || run.lock?.ownerHash !== ownerHash) return null;
            Object.assign(run, {
                status,
                totals: clone(totals),
                errorSample: clone(errorSample),
                heartbeatAt: now,
                finishedAt: ['completed', 'completed_with_errors'].includes(status) ? now : null,
                lock: {},
            });
            return clone(run);
        },
        async failRun({ runId, ownerHash, totals, errorSample, now }) {
            const run = state.runs.get(runId);
            if (!run || run.lock?.ownerHash !== ownerHash) return null;
            Object.assign(run, {
                status: 'failed',
                totals: clone(totals),
                errorSample: clone(errorSample),
                heartbeatAt: now,
                finishedAt: now,
                lock: {},
            });
            return clone(run);
        },
    };

    return { state, store };
};

const runOptions = (overrides = {}) => ({
    mode: 'audit',
    audience: 'all',
    runId: 'trusted-device-v2-audit-test',
    requestedBy: 'security-test-operator',
    pseudonymKey: PSEUDONYM_KEY,
    batchSize: 1,
    maxBatches: 100,
    leaseSeconds: 30,
    ...overrides,
});

describe('trustedDeviceV2MigrationService', () => {
    test('rejects an unknown migration mode instead of silently auditing', async () => {
        const { store } = createInMemoryStore();
        await expect(runTrustedDeviceV2Migration(runOptions({ mode: 'delete' }), { store }))
            .rejects
            .toMatchObject({ code: 'MIGRATION_MODE_INVALID' });
    });

    test('transforms legacy WebAuthn as unverified and preserves only observed backup state', () => {
        const user = buildUsers()[1];
        const transformed = transformLegacyTrustedDevice({
            user,
            device: user.trustedDevices[0],
            migrationRunId: '000000000000000000000001',
            sourceSnapshotAt: BASE_TIME,
            pseudonymKey: PSEUDONYM_KEY,
        });

        expect(transformed.issue).toBeUndefined();
        expect(transformed.record).toMatchObject({
            credentialKind: 'webauthn',
            assurance: 'passkey_legacy_unverified',
            credentialScope: 'recognition',
            enrollmentContext: 'legacy_admin_snapshot',
            adminEligibility: 'legacy_candidate',
            backupStateKnown: true,
            backupEligible: true,
            backedUp: true,
        });
        expect(transformed.record.adminEligibleAt).toBeNull();
    });

    test('rejects a legacy device ID that the V2 runtime can never address', () => {
        const user = buildUsers()[0];
        const transformed = transformLegacyTrustedDevice({
            user,
            device: { ...user.trustedDevices[0], deviceId: 'bad id' },
            migrationRunId: '000000000000000000000001',
            sourceSnapshotAt: BASE_TIME,
            pseudonymKey: PSEUDONYM_KEY,
        });

        expect(transformed.issue).toMatchObject({
            code: 'SOURCE_DEVICE_INVALID',
            detailCode: 'invalid_device_id',
        });
    });

    test('binds idempotent migration upserts to the approved source and apply run', () => {
        const user = buildUsers()[0];
        const transformed = transformLegacyTrustedDevice({
            user,
            device: user.trustedDevices[0],
            migrationRunId: '000000000000000000000001',
            sourceSnapshotAt: BASE_TIME,
            pseudonymKey: PSEUDONYM_KEY,
        });
        const [operation] = buildCredentialUpsertOperations([transformed.record]);

        expect(operation.updateOne.filter).toMatchObject({
            user: user._id,
            deviceIdHash: transformed.record.deviceIdHash,
            migrationRun: '000000000000000000000001',
            provenance: 'legacy_backfill',
            legacyRecordHash: transformed.record.legacyRecordHash,
        });
    });

    test('runs a resumable audit, emits source-bound approval, then applies the same source', async () => {
        const { state, store } = createInMemoryStore();
        const now = createClock();

        const paused = await runTrustedDeviceV2Migration(runOptions({ maxBatches: 1 }), { store, now });
        expect(paused).toMatchObject({
            transformVersion: MIGRATION_TRANSFORM_VERSION,
            mode: 'audit',
            status: 'paused',
            totals: { scanned: 1, eligible: 1, migrated: 0, skipped: 0, failed: 0 },
        });
        expect(paused.approvalHash).toBeNull();
        expect(state.credentials).toHaveLength(0);

        const audit = await runTrustedDeviceV2Migration(runOptions({ maxBatches: 10 }), { store, now });
        expect(audit.status).toBe('completed');
        expect(audit.totals).toEqual({
            scanned: 2,
            eligible: 2,
            migrated: 0,
            skipped: 0,
            failed: 0,
        });
        expect(audit.checkpoint.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(audit.approvalHash).toMatch(/^[a-f0-9]{64}$/);
        expect(buildAuditApprovalHash(await store.getRun(audit.runId))).toBe(audit.approvalHash);

        const apply = await runTrustedDeviceV2Migration(runOptions({
            mode: 'apply',
            runId: 'trusted-device-v2-apply-test',
            auditRunId: audit.runId,
            approvalHash: audit.approvalHash,
            approvedBy: 'security-approver',
        }), { store, now });

        expect(apply).toMatchObject({
            mode: 'apply',
            status: 'completed',
            approvalHash: audit.approvalHash,
            totals: { scanned: 2, eligible: 2, migrated: 2, skipped: 0, failed: 0 },
        });
        expect(apply.checkpoint.sourceDigest).toBe(audit.checkpoint.sourceDigest);
        expect(apply.rollbackPlan.guard).toMatchObject({
            requireExportDigestBeforeDelete: true,
            requireExactCountMatch: true,
            legacyUserDocumentsRemainUntouched: true,
        });
        expect(state.credentials).toHaveLength(2);
        expect(state.credentials.every((record) => record.provenance === 'legacy_backfill')).toBe(true);
    });

    test('fails apply evidence when the approved legacy source drifts', async () => {
        const { state, store } = createInMemoryStore();
        const now = createClock();
        const audit = await runTrustedDeviceV2Migration(runOptions(), { store, now });

        state.sourceUsers[0].trustedDevices[0].label = 'Changed after approval';

        await expect(runTrustedDeviceV2Migration(runOptions({
            mode: 'apply',
            runId: 'trusted-device-v2-apply-drift-test',
            auditRunId: audit.runId,
            approvalHash: audit.approvalHash,
            approvedBy: 'security-approver',
        }), { store, now })).rejects.toMatchObject({ code: 'MIGRATION_SOURCE_DRIFT' });

        expect((await store.getRun('trusted-device-v2-apply-drift-test')).status).toBe('failed');
        expect(state.credentials).toHaveLength(0);
    });

    test('withholds approval when audit skips an invalid source record', async () => {
        const users = buildUsers();
        users[0].trustedDevices[0].publicKeySpkiBase64 = '';
        const { store } = createInMemoryStore(users);

        const audit = await runTrustedDeviceV2Migration(runOptions(), {
            store,
            now: createClock(),
        });

        expect(audit).toMatchObject({
            status: 'completed',
            approvalHash: null,
            totals: { scanned: 2, eligible: 1, skipped: 1, failed: 0 },
        });
        expect(audit.errorSample[0]).toMatchObject({
            code: 'SOURCE_DEVICE_INVALID',
            detailCode: 'missing_public_key',
        });
    });

    test('rejects a conflicting run created between lookup and create', async () => {
        const { store } = createInMemoryStore();
        const racedStore = {
            ...store,
            getRun: jest.fn().mockResolvedValue(null),
            createRun: jest.fn(async (document) => ({
                _id: '000000000000000000000099',
                ...clone(document),
                audience: 'admin',
            })),
        };

        await expect(runTrustedDeviceV2Migration(runOptions(), {
            store: racedStore,
            now: createClock(),
        })).rejects.toMatchObject({ code: 'MIGRATION_RESUME_CONFIG_MISMATCH' });
        expect(racedStore.createRun).toHaveBeenCalledTimes(1);
    });

    test('does not expose operator identity, pseudonym key, or credential material in evidence', async () => {
        const { store } = createInMemoryStore();
        const evidence = await runTrustedDeviceV2Migration(runOptions(), {
            store,
            now: createClock(),
        });
        const serialized = JSON.stringify(evidence);

        expect(serialized).not.toContain('security-test-operator');
        expect(serialized).not.toContain(PSEUDONYM_KEY);
        expect(serialized).not.toContain('public-key-device');
        expect(serialized).not.toContain('admin-credential-0001');
    });
});
