const crypto = require('crypto');

const MIGRATION_TRANSFORM_VERSION = 'trusted-device-v2-legacy-backfill-v2';
const EVIDENCE_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;
const MAX_PUBLIC_KEY_LENGTH = 16_384;
const MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH = 2_048;
const ALLOWED_AUDIENCES = new Set(['admin', 'public', 'all']);
const TERMINAL_STATUSES = new Set([
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
]);
const ACTIVE_RUN_STATUSES = ['planned', 'running', 'paused'];
const ALLOWED_WEBAUTHN_TRANSPORTS = new Set([
    'ble',
    'cable',
    'hybrid',
    'internal',
    'nfc',
    'smart-card',
    'usb',
]);
const ALLOWED_USER_VERIFICATION = new Set(['required', 'preferred', 'discouraged', '']);
const ALLOWED_AUTHENTICATOR_ATTACHMENTS = new Set(['platform', 'cross-platform', '']);
const MAX_BATCH_SIZE = 200;
const MAX_BATCHES_PER_INVOCATION = 10_000;
const MAX_ERROR_SAMPLE_SIZE = 20;
const MIN_LEASE_SECONDS = 15;
const MAX_LEASE_SECONDS = 15 * 60;

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();

const createMigrationError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

const normalizeInteger = (value, fallback, { min, max }) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
    return parsed;
};

const canonicalize = (value) => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;

    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            const nextValue = value[key];
            if (nextValue !== undefined) result[key] = canonicalize(nextValue);
            return result;
        }, {});
};

const stableStringify = (value) => JSON.stringify(canonicalize(value));
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hmacSha256 = (key, value) => crypto
    .createHmac('sha256', String(key))
    .update(String(value))
    .digest('hex');

const normalizeDate = (value) => {
    if (!value) return null;
    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toIso = (value) => normalizeDate(value)?.toISOString() || null;
const toIdString = (value) => normalizeText(value?._id || value);

const normalizeHash = (value) => {
    const normalized = normalizeLower(value);
    return HASH_PATTERN.test(normalized) ? normalized : '';
};

const normalizeErrorCode = (value, fallback = 'UNKNOWN') => {
    const normalized = normalizeText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return normalized || fallback;
};

const normalizeDetailCode = (value, fallback = '') => {
    const normalized = normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return normalized || fallback;
};

const safeHashEqual = (left, right) => {
    const normalizedLeft = normalizeHash(left);
    const normalizedRight = normalizeHash(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return crypto.timingSafeEqual(
        Buffer.from(normalizedLeft, 'hex'),
        Buffer.from(normalizedRight, 'hex')
    );
};

const isAdminUser = (user = {}) => Boolean(
    user?.isAdmin
    || (Array.isArray(user?.adminRoles) && user.adminRoles.length > 0)
);

const getCredentialKind = (device = {}) => {
    const method = normalizeLower(device?.method);
    if (method === 'webauthn' || normalizeText(device?.webauthnCredentialIdBase64Url)) {
        return 'webauthn';
    }
    return 'browser_key';
};

const buildSubjectHash = ({ pseudonymKey, userId, device = {}, deviceIndex = 0 }) => {
    const deviceReference = normalizeText(
        device?.deviceId
        || device?.webauthnCredentialIdBase64Url
        || device?.publicKeySpkiBase64
        || `index:${deviceIndex}`
    );
    return hmacSha256(
        pseudonymKey,
        `aura/trusted-device-v2/migration-subject/${userId}/${deviceReference}`
    );
};

const buildLegacyRecordHash = ({ user = {}, userId, device = {} }) => sha256(stableStringify({
    userId,
    adminSubject: isAdminUser(user),
    deviceId: normalizeText(device.deviceId),
    deviceIdHash: normalizeHash(device.deviceIdHash),
    label: normalizeText(device.label),
    method: getCredentialKind(device),
    algorithm: normalizeText(device.algorithm),
    publicKeySpkiBase64: normalizeText(device.publicKeySpkiBase64),
    webauthnCredentialIdBase64Url: normalizeText(device.webauthnCredentialIdBase64Url),
    webauthnCounter: Number(device.webauthnCounter || 0),
    webauthnTransports: Array.isArray(device.webauthnTransports)
        ? device.webauthnTransports.map(normalizeLower)
        : [],
    webauthnUserVerification: normalizeLower(device.webauthnUserVerification),
    webauthnUserVerified: device.webauthnUserVerified === true,
    webauthnUserVerifiedAt: toIso(device.webauthnUserVerifiedAt),
    webauthnAaguid: normalizeText(device.webauthnAaguid),
    authenticatorAttachment: normalizeLower(device.authenticatorAttachment),
    webauthnBackupEligible: Boolean(device.webauthnBackupEligible),
    webauthnBackedUp: Boolean(device.webauthnBackedUp),
    webauthnBackupStateObservedAt: toIso(device.webauthnBackupStateObservedAt),
    credentialScope: normalizeLower(device.credentialScope),
    enrollmentContext: normalizeLower(device.enrollmentContext),
    adminEligibility: normalizeLower(device.adminEligibility),
    sessionVersion: normalizeText(device.sessionVersion),
    createdAt: toIso(device.createdAt),
    lastSeenAt: toIso(device.lastSeenAt),
    lastVerifiedAt: toIso(device.lastVerifiedAt),
    expiresAt: toIso(device.expiresAt),
    revokedAt: toIso(device.revokedAt),
}));

const createInitialSourceDigest = () => sha256(stableStringify({
    contract: MIGRATION_TRANSFORM_VERSION,
    sourceSchemaVersion: 1,
}));

const extendSourceDigest = ({ previousDigest, user = {}, device = {}, deviceIndex = 0 }) => {
    const userId = toIdString(user);
    return sha256(stableStringify({
        previousDigest: normalizeHash(previousDigest) || createInitialSourceDigest(),
        userId,
        deviceIndex,
        legacyRecordHash: buildLegacyRecordHash({ user, userId, device }),
    }));
};

const sourceIssue = ({ subjectHash, code = 'SOURCE_DEVICE_INVALID', detailCode }) => ({
    subjectHash,
    code: normalizeErrorCode(code, 'SOURCE_DEVICE_INVALID'),
    detailCode: normalizeDetailCode(detailCode, 'invalid_source_record'),
});

const transformLegacyTrustedDevice = ({
    user,
    device,
    deviceIndex = 0,
    migrationRunId,
    sourceSnapshotAt,
    pseudonymKey,
}) => {
    const userId = toIdString(user);
    const subjectHash = buildSubjectHash({ pseudonymKey, userId, device, deviceIndex });
    const snapshotAt = normalizeDate(sourceSnapshotAt);
    const sourceCreatedAt = normalizeDate(device?.createdAt);

    if (!userId) {
        return { issue: sourceIssue({ subjectHash, detailCode: 'missing_user_id' }), subjectHash };
    }
    if (sourceCreatedAt && snapshotAt && sourceCreatedAt.getTime() > snapshotAt.getTime()) {
        return {
            issue: sourceIssue({
                subjectHash,
                code: 'SOURCE_AFTER_SNAPSHOT',
                detailCode: 'created_after_source_snapshot',
            }),
            subjectHash,
        };
    }

    const deviceId = normalizeText(device?.deviceId);
    const publicKeySpkiBase64 = normalizeText(device?.publicKeySpkiBase64);
    if (!deviceId) {
        return { issue: sourceIssue({ subjectHash, detailCode: 'missing_device_id' }), subjectHash };
    }
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
        return { issue: sourceIssue({ subjectHash, detailCode: 'invalid_device_id' }), subjectHash };
    }
    if (!publicKeySpkiBase64) {
        return { issue: sourceIssue({ subjectHash, detailCode: 'missing_public_key' }), subjectHash };
    }
    if (publicKeySpkiBase64.length > MAX_PUBLIC_KEY_LENGTH) {
        return { issue: sourceIssue({ subjectHash, detailCode: 'public_key_too_large' }), subjectHash };
    }

    const credentialKind = getCredentialKind(device);
    const webauthnCredentialIdBase64Url = credentialKind === 'webauthn'
        ? normalizeText(device?.webauthnCredentialIdBase64Url)
        : '';
    if (credentialKind === 'webauthn' && !webauthnCredentialIdBase64Url) {
        return {
            issue: sourceIssue({ subjectHash, detailCode: 'missing_webauthn_credential_id' }),
            subjectHash,
        };
    }
    if (
        credentialKind === 'webauthn'
        && webauthnCredentialIdBase64Url.length > MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH
    ) {
        return {
            issue: sourceIssue({ subjectHash, detailCode: 'webauthn_credential_id_too_large' }),
            subjectHash,
        };
    }

    const legacyRecordHash = buildLegacyRecordHash({ user, userId, device });
    // Runtime lookups derive this value from the exact normalized device ID.
    // Never trust a legacy hash whose derivation contract is unknown.
    const deviceIdHash = sha256(deviceId);
    const revokedAt = normalizeDate(device?.revokedAt);
    const adminCandidate = credentialKind === 'webauthn' && isAdminUser(user);
    const normalizedVerification = normalizeLower(device?.webauthnUserVerification);
    const normalizedAttachment = normalizeLower(device?.authenticatorAttachment);
    const lastVerifiedAt = normalizeDate(device?.lastVerifiedAt)
        || sourceCreatedAt
        || snapshotAt
        || new Date(0);
    const normalizedCounter = Number(device?.webauthnCounter || 0);
    const backupStateObservedAt = normalizeDate(device?.webauthnBackupStateObservedAt);
    const backupStateKnown = credentialKind === 'webauthn' && Boolean(backupStateObservedAt);
    const backupEligible = backupStateKnown && Boolean(device?.webauthnBackupEligible);
    const backedUp = backupEligible && Boolean(device?.webauthnBackedUp);

    const record = {
        schemaVersion: 2,
        user: user?._id,
        credentialKind,
        deviceIdHash,
        browserKeyHash: credentialKind === 'browser_key' ? sha256(publicKeySpkiBase64) : null,
        webauthnCredentialIdHash: credentialKind === 'webauthn'
            ? sha256(webauthnCredentialIdBase64Url)
            : null,
        webauthnCredentialIdBase64Url: credentialKind === 'webauthn'
            ? webauthnCredentialIdBase64Url
            : null,
        label: normalizeText(device?.label).slice(0, 120),
        algorithm: (normalizeText(device?.algorithm) || 'RSA-PSS-SHA256').slice(0, 64),
        publicKeySpkiBase64,
        webauthnTransports: credentialKind === 'webauthn'
            ? [...new Set((Array.isArray(device?.webauthnTransports) ? device.webauthnTransports : [])
                .map(normalizeLower)
                .filter((entry) => ALLOWED_WEBAUTHN_TRANSPORTS.has(entry)))]
            : [],
        webauthnCounter: credentialKind === 'webauthn' && Number.isFinite(normalizedCounter)
            ? Math.max(Math.trunc(normalizedCounter), 0)
            : 0,
        webauthnUserVerification: credentialKind === 'webauthn'
            && ALLOWED_USER_VERIFICATION.has(normalizedVerification)
            ? normalizedVerification
            : '',
        webauthnUserVerified: false,
        webauthnUserVerifiedAt: null,
        webauthnAaguid: credentialKind === 'webauthn'
            ? normalizeText(device?.webauthnAaguid).slice(0, 64)
            : '',
        authenticatorAttachment: credentialKind === 'webauthn'
            && ALLOWED_AUTHENTICATOR_ATTACHMENTS.has(normalizedAttachment)
            ? normalizedAttachment
            : '',
        backupEligible,
        backedUp,
        backupStateKnown,
        backupStateObservedAt: backupStateKnown ? backupStateObservedAt : null,
        provenance: 'legacy_backfill',
        migrationRun: migrationRunId,
        legacyRecordHash,
        credentialScope: 'recognition',
        enrollmentContext: adminCandidate ? 'legacy_admin_snapshot' : 'device_recognition',
        adminEligibility: adminCandidate ? 'legacy_candidate' : 'none',
        adminEligibleAt: null,
        legacyAdminCandidateAt: adminCandidate ? snapshotAt : null,
        assurance: credentialKind === 'webauthn' ? 'passkey_legacy_unverified' : 'browser_bound',
        status: revokedAt ? 'revoked' : 'active',
        sessionVersion: (normalizeText(device?.sessionVersion)
            || `legacy:${legacyRecordHash.slice(0, 32)}`).slice(0, 128),
        createdAt: sourceCreatedAt || snapshotAt,
        lastSeenAt: normalizeDate(device?.lastSeenAt),
        lastVerifiedAt,
        expiresAt: normalizeDate(device?.expiresAt),
        revokedAt,
        revocationReasonCode: revokedAt ? 'legacy_source_revoked' : '',
        revokedByHash: null,
    };

    return { record, subjectHash };
};

const buildCredentialUpsertOperations = (records = []) => records.map((record) => ({
    updateOne: {
        filter: {
            user: record.user,
            deviceIdHash: record.deviceIdHash,
            migrationRun: record.migrationRun,
            provenance: 'legacy_backfill',
            legacyRecordHash: record.legacyRecordHash,
        },
        update: {
            $setOnInsert: record,
        },
        upsert: true,
    },
}));

const buildSourceUserFilter = ({ audience = 'all', afterUserId = null } = {}) => {
    const clauses = [{ 'trustedDevices.0': { $exists: true } }];
    if (afterUserId) clauses.push({ _id: { $gt: afterUserId } });
    if (audience === 'admin') {
        clauses.push({
            $or: [
                { isAdmin: true },
                { 'adminRoles.0': { $exists: true } },
            ],
        });
    }
    if (audience === 'public') {
        clauses.push({
            isAdmin: { $ne: true },
            'adminRoles.0': { $exists: false },
        });
    }
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

const normalizeTotals = (totals = {}) => ({
    scanned: Math.max(Number(totals.scanned || 0), 0),
    eligible: Math.max(Number(totals.eligible || 0), 0),
    migrated: Math.max(Number(totals.migrated || 0), 0),
    skipped: Math.max(Number(totals.skipped || 0), 0),
    failed: Math.max(Number(totals.failed || 0), 0),
});

const normalizeCheckpoint = (checkpoint = {}) => ({
    lastUserId: checkpoint.lastUserId || null,
    batchNumber: Math.max(Number(checkpoint.batchNumber || 0), 0),
    scannedCount: Math.max(Number(checkpoint.scannedCount || 0), 0),
    sourceDigest: normalizeHash(checkpoint.sourceDigest) || createInitialSourceDigest(),
    updatedAt: normalizeDate(checkpoint.updatedAt),
});

const buildMigrationConfigHash = ({
    audience,
    sourceSnapshotAt,
    batchSize,
    maxErrorSamples,
}) => sha256(stableStringify({
    transformVersion: MIGRATION_TRANSFORM_VERSION,
    sourceSchemaVersion: 1,
    targetSchemaVersion: 2,
    audience,
    sourceSnapshotAt: toIso(sourceSnapshotAt),
    batchSize,
    maxErrorSamples,
}));

const buildAuditApprovalHash = (run = {}) => {
    if (run.mode !== 'audit' || run.status !== 'completed') return null;
    const totals = normalizeTotals(run.totals);
    if (totals.failed > 0 || totals.skipped > 0) return null;
    const sourceDigest = normalizeHash(run.checkpoint?.sourceDigest);
    if (!sourceDigest) return null;

    return sha256(stableStringify({
        approvalContract: MIGRATION_TRANSFORM_VERSION,
        auditRunId: normalizeText(run.runId),
        audience: normalizeText(run.audience),
        sourceSnapshotAt: toIso(run.sourceSnapshotAt),
        sourceSchemaVersion: Number(run.sourceSchemaVersion || 1),
        targetSchemaVersion: Number(run.targetSchemaVersion || 2),
        configHash: normalizeHash(run.configHash),
        sourceDigest,
        totals,
    }));
};

const buildRollbackPlan = (run = {}) => {
    if (run.mode !== 'apply') return null;
    const selector = {
        migrationRun: toIdString(run),
        provenance: 'legacy_backfill',
        schemaVersion: 2,
    };
    const expectedCredentialCount = normalizeTotals(run.totals).migrated;
    const rollbackGuardHash = sha256(stableStringify({ selector, expectedCredentialCount }));

    return {
        strategy: 'export_then_delete_v2_backfill_only',
        selector,
        export: {
            sort: { user: 1, deviceIdHash: 1, _id: 1 },
            projection: [
                '_id',
                'schemaVersion',
                'user',
                'credentialKind',
                'deviceIdHash',
                'legacyRecordHash',
                'provenance',
                'migrationRun',
                'status',
                'createdAt',
                'updatedAt',
            ],
            digestAlgorithm: 'sha256',
            expectedCredentialCount,
        },
        guard: {
            rollbackGuardHash,
            requireExportDigestBeforeDelete: true,
            requireExactCountMatch: true,
            legacyUserDocumentsRemainUntouched: true,
        },
    };
};

const buildMigrationEvidence = (run = {}) => {
    const errorSample = Array.isArray(run.errorSample)
        ? run.errorSample.slice(0, MAX_ERROR_SAMPLE_SIZE).map((entry) => ({
            subjectHash: normalizeHash(entry.subjectHash),
            code: normalizeErrorCode(entry.code),
            detailCode: normalizeDetailCode(entry.detailCode),
            recordedAt: toIso(entry.recordedAt),
        }))
        : [];
    const approvalHash = run.mode === 'audit'
        ? buildAuditApprovalHash(run)
        : normalizeHash(run.approval?.changeTicketHash);
    const evidence = {
        evidenceVersion: EVIDENCE_VERSION,
        transformVersion: MIGRATION_TRANSFORM_VERSION,
        runId: normalizeText(run.runId),
        migrationRunId: toIdString(run),
        mode: normalizeText(run.mode),
        audience: normalizeText(run.audience),
        status: normalizeText(run.status),
        sourceSchemaVersion: Number(run.sourceSchemaVersion || 1),
        targetSchemaVersion: Number(run.targetSchemaVersion || 2),
        sourceSnapshotAt: toIso(run.sourceSnapshotAt),
        configHash: normalizeHash(run.configHash),
        approvalHash,
        checkpoint: {
            ...normalizeCheckpoint(run.checkpoint),
            lastUserId: toIdString(run.checkpoint?.lastUserId) || null,
            sourceDigest: normalizeHash(run.checkpoint?.sourceDigest),
            updatedAt: toIso(run.checkpoint?.updatedAt),
        },
        totals: normalizeTotals(run.totals),
        errorSample,
        rollbackPlan: buildRollbackPlan(run),
    };

    return {
        ...evidence,
        evidenceHash: sha256(stableStringify(evidence)),
    };
};

const asPlain = (value) => {
    if (!value) return null;
    if (typeof value.toObject === 'function') return value.toObject({ depopulate: true });
    return value;
};

const resolveQuery = async (query) => {
    if (!query) return query;
    return query;
};

const getWriteErrors = (error) => {
    if (Array.isArray(error?.writeErrors)) return error.writeErrors;
    if (typeof error?.result?.getWriteErrors === 'function') return error.result.getWriteErrors();
    return [];
};

const classifyWriteError = (error = {}) => {
    const code = Number(error?.code || error?.err?.code || 0);
    if (code === 11000) return { code: 'TARGET_CONFLICT', detailCode: 'duplicate_key' };
    if (code === 121) return { code: 'TARGET_VALIDATION_FAILED', detailCode: 'document_validation' };
    return {
        code: 'TARGET_WRITE_FAILED',
        detailCode: normalizeDetailCode(code ? `mongo_${code}` : 'bounded_write_error'),
    };
};

const createMongooseTrustedDeviceMigrationStore = ({
    UserModel,
    CredentialModel,
    MigrationRunModel,
}) => {
    if (!UserModel || !CredentialModel || !MigrationRunModel) {
        throw new TypeError('UserModel, CredentialModel, and MigrationRunModel are required');
    }

    const runSelection = [
        '+requestedByHash',
        '+approval.approvedByHash',
        '+approval.changeTicketHash',
        '+lock.ownerHash',
        '+errorSample.subjectHash',
    ].join(' ');

    const toPlainRun = async (query) => {
        if (!query) return null;
        const selected = typeof query.select === 'function' ? query.select(runSelection) : query;
        const lean = typeof selected.lean === 'function' ? selected.lean() : selected;
        return asPlain(await resolveQuery(lean));
    };

    return {
        async getRun(runId) {
            return toPlainRun(MigrationRunModel.findOne({ runId }));
        },

        async createRun(document) {
            try {
                return asPlain(await MigrationRunModel.create(document));
            } catch (error) {
                if (Number(error?.code || 0) !== 11000) throw error;
                return this.getRun(document.runId);
            }
        },

        async acquireLease({ runId, ownerHash, now, leaseExpiresAt, startedAt }) {
            return toPlainRun(MigrationRunModel.findOneAndUpdate(
                {
                    runId,
                    status: { $in: ACTIVE_RUN_STATUSES },
                    $or: [
                        { 'lock.ownerHash': ownerHash },
                        { 'lock.ownerHash': null },
                        { 'lock.ownerHash': { $exists: false } },
                        { 'lock.leaseExpiresAt': null },
                        { 'lock.leaseExpiresAt': { $lte: now } },
                    ],
                },
                {
                    $set: {
                        status: 'running',
                        startedAt,
                        heartbeatAt: now,
                        'lock.ownerHash': ownerHash,
                        'lock.acquiredAt': now,
                        'lock.leaseExpiresAt': leaseExpiresAt,
                    },
                },
                { new: true, runValidators: true }
            ));
        },

        async listSourceUsers({ audience, afterUserId, limit }) {
            let query = UserModel.find(buildSourceUserFilter({ audience, afterUserId }))
                .select('_id isAdmin adminRoles trustedDevices')
                .sort({ _id: 1 })
                .limit(limit);
            if (typeof query.lean === 'function') query = query.lean();
            return (await resolveQuery(query)) || [];
        },

        async upsertCredentials(records) {
            const validRecords = [];
            const failures = [];

            for (let index = 0; index < records.length; index += 1) {
                const record = records[index];
                try {
                    const document = new CredentialModel(record);
                    await document.validate();
                    const plain = document.toObject({ depopulate: true });
                    delete plain._id;
                    delete plain.__v;
                    validRecords.push({ originalIndex: index, record: plain });
                } catch {
                    failures.push({
                        index,
                        code: 'TARGET_VALIDATION_FAILED',
                        detailCode: 'schema_validation',
                    });
                }
            }

            if (validRecords.length === 0) {
                return { successfulCount: 0, failures };
            }

            try {
                await CredentialModel.bulkWrite(
                    buildCredentialUpsertOperations(validRecords.map((entry) => entry.record)),
                    { ordered: false }
                );
                return { successfulCount: validRecords.length, failures };
            } catch (error) {
                const writeErrors = getWriteErrors(error);
                if (writeErrors.length === 0) {
                    throw createMigrationError(
                        'TARGET_BATCH_WRITE_UNCERTAIN',
                        'Target batch write outcome is uncertain; the checkpoint was not advanced.'
                    );
                }

                const failedValidIndexes = new Set();
                writeErrors.forEach((writeError) => {
                    const validIndex = Number(writeError?.index);
                    const mapped = validRecords[validIndex];
                    if (!mapped) return;
                    failedValidIndexes.add(validIndex);
                    failures.push({
                        index: mapped.originalIndex,
                        ...classifyWriteError(writeError),
                    });
                });
                return {
                    successfulCount: validRecords.length - failedValidIndexes.size,
                    failures,
                };
            }
        },

        async saveProgress({
            runId,
            ownerHash,
            checkpoint,
            totals,
            errorSample,
            now,
            leaseExpiresAt,
        }) {
            return toPlainRun(MigrationRunModel.findOneAndUpdate(
                {
                    runId,
                    status: 'running',
                    'lock.ownerHash': ownerHash,
                },
                {
                    $set: {
                        checkpoint,
                        totals,
                        errorSample,
                        heartbeatAt: now,
                        'lock.leaseExpiresAt': leaseExpiresAt,
                    },
                },
                { new: true, runValidators: true }
            ));
        },

        async finishRun({ runId, ownerHash, status, totals, errorSample, now }) {
            return toPlainRun(MigrationRunModel.findOneAndUpdate(
                {
                    runId,
                    status: 'running',
                    'lock.ownerHash': ownerHash,
                },
                {
                    $set: {
                        status,
                        totals,
                        errorSample,
                        heartbeatAt: now,
                        finishedAt: TERMINAL_STATUSES.has(status) ? now : null,
                        'lock.ownerHash': null,
                        'lock.acquiredAt': null,
                        'lock.leaseExpiresAt': null,
                    },
                },
                { new: true, runValidators: true }
            ));
        },

        async failRun({ runId, ownerHash, totals, errorSample, now }) {
            return toPlainRun(MigrationRunModel.findOneAndUpdate(
                {
                    runId,
                    status: 'running',
                    'lock.ownerHash': ownerHash,
                },
                {
                    $set: {
                        status: 'failed',
                        totals,
                        errorSample,
                        heartbeatAt: now,
                        finishedAt: now,
                        'lock.ownerHash': null,
                        'lock.acquiredAt': null,
                        'lock.leaseExpiresAt': null,
                    },
                },
                { new: true, runValidators: true }
            ));
        },
    };
};

const validateRunOptions = (options = {}) => {
    const requestedMode = normalizeLower(options.mode);
    if (requestedMode && !['audit', 'apply'].includes(requestedMode)) {
        throw createMigrationError('MIGRATION_MODE_INVALID', 'mode must be audit or apply.');
    }
    const mode = requestedMode || 'audit';
    const audience = normalizeLower(options.audience) || 'all';
    const runId = normalizeText(options.runId);
    const requestedBy = normalizeText(options.requestedBy);
    const approvedBy = normalizeText(options.approvedBy);
    const pseudonymKey = normalizeText(options.pseudonymKey);
    const batchSize = normalizeInteger(options.batchSize, 50, { min: 1, max: MAX_BATCH_SIZE });
    const maxBatches = normalizeInteger(options.maxBatches, 100, {
        min: 1,
        max: MAX_BATCHES_PER_INVOCATION,
    });
    const leaseSeconds = normalizeInteger(options.leaseSeconds, 60, {
        min: MIN_LEASE_SECONDS,
        max: MAX_LEASE_SECONDS,
    });
    const maxErrorSamples = normalizeInteger(options.maxErrorSamples, MAX_ERROR_SAMPLE_SIZE, {
        min: 0,
        max: MAX_ERROR_SAMPLE_SIZE,
    });

    if (!RUN_ID_PATTERN.test(runId)) {
        throw createMigrationError('MIGRATION_RUN_ID_INVALID', 'runId must use 1-128 safe characters.');
    }
    if (!ALLOWED_AUDIENCES.has(audience)) {
        throw createMigrationError('MIGRATION_AUDIENCE_INVALID', 'audience must be admin, public, or all.');
    }
    if (!requestedBy) {
        throw createMigrationError('MIGRATION_OPERATOR_REQUIRED', 'requestedBy is required.');
    }
    if (pseudonymKey.length < 32) {
        throw createMigrationError(
            'MIGRATION_PSEUDONYM_KEY_REQUIRED',
            'A pseudonym key of at least 32 characters is required.'
        );
    }
    if (mode === 'apply' && !approvedBy) {
        throw createMigrationError('MIGRATION_APPROVER_REQUIRED', 'approvedBy is required for apply mode.');
    }

    return {
        ...options,
        mode,
        audience,
        runId,
        requestedBy,
        approvedBy,
        pseudonymKey,
        batchSize,
        maxBatches,
        leaseSeconds,
        maxErrorSamples,
    };
};

const appendErrorSample = (entries, issue, recordedAt, maxSize) => {
    if (!issue || entries.length >= maxSize) return entries;
    return [
        ...entries,
        {
            subjectHash: normalizeHash(issue.subjectHash),
            code: normalizeErrorCode(issue.code),
            detailCode: normalizeDetailCode(issue.detailCode),
            recordedAt,
        },
    ];
};

const prepareApplyApproval = async ({ options, store }) => {
    const auditRunId = normalizeText(options.auditRunId);
    const suppliedApprovalHash = normalizeHash(options.approvalHash);
    if (!auditRunId || !suppliedApprovalHash) {
        throw createMigrationError(
            'MIGRATION_APPROVAL_REQUIRED',
            'Apply mode requires auditRunId and a 64-character approvalHash.'
        );
    }
    if (auditRunId === options.runId) {
        throw createMigrationError(
            'MIGRATION_APPLY_RUN_ID_INVALID',
            'Apply mode must use a distinct runId so audit evidence remains immutable.'
        );
    }

    const auditRun = await store.getRun(auditRunId);
    const expectedApprovalHash = buildAuditApprovalHash(auditRun || {});
    if (!auditRun || !expectedApprovalHash || !safeHashEqual(expectedApprovalHash, suppliedApprovalHash)) {
        throw createMigrationError(
            'MIGRATION_APPROVAL_INVALID',
            'The approval hash does not match a completed, error-free audit run.'
        );
    }
    if (normalizeText(auditRun.audience) !== options.audience) {
        throw createMigrationError(
            'MIGRATION_APPROVAL_SCOPE_MISMATCH',
            'The apply audience must match the approved audit audience.'
        );
    }

    return { auditRun, approvalHash: suppliedApprovalHash };
};

const inspectSourceFingerprint = async ({
    store,
    options,
    sourceSnapshotAt,
    migrationRunId,
}) => {
    let afterUserId = null;
    let sourceDigest = createInitialSourceDigest();
    let scanned = 0;
    let eligible = 0;
    let skipped = 0;
    let batches = 0;
    let exhausted = false;

    while (batches < MAX_BATCHES_PER_INVOCATION) {
        const users = await store.listSourceUsers({
            audience: options.audience,
            afterUserId,
            limit: options.batchSize + 1,
        });
        const hasMore = users.length > options.batchSize;
        const batchUsers = users.slice(0, options.batchSize);
        if (batchUsers.length === 0) {
            exhausted = true;
            break;
        }

        const seenRecordKeys = new Set();
        batchUsers.forEach((user) => {
            const devices = Array.isArray(user?.trustedDevices) ? user.trustedDevices : [];
            devices.forEach((device, deviceIndex) => {
                scanned += 1;
                sourceDigest = extendSourceDigest({
                    previousDigest: sourceDigest,
                    user,
                    device,
                    deviceIndex,
                });

                let transformed;
                try {
                    transformed = transformLegacyTrustedDevice({
                        user,
                        device,
                        deviceIndex,
                        migrationRunId,
                        sourceSnapshotAt,
                        pseudonymKey: options.pseudonymKey,
                    });
                } catch {
                    skipped += 1;
                    return;
                }
                if (transformed.issue) {
                    skipped += 1;
                    return;
                }

                const recordKey = `${toIdString(user)}:${transformed.record.deviceIdHash}`;
                if (seenRecordKeys.has(recordKey)) {
                    skipped += 1;
                    return;
                }
                seenRecordKeys.add(recordKey);
                eligible += 1;
            });
        });

        afterUserId = batchUsers[batchUsers.length - 1]._id;
        batches += 1;
        if (!hasMore) {
            exhausted = true;
            break;
        }
    }

    if (!exhausted) {
        throw createMigrationError(
            'MIGRATION_PREFLIGHT_LIMIT_EXCEEDED',
            'Apply preflight exceeded the bounded source scan limit.'
        );
    }

    return { sourceDigest, scanned, eligible, skipped };
};

const sourceFingerprintMatchesApproval = ({ fingerprint, auditRun }) => {
    const approvedTotals = normalizeTotals(auditRun?.totals);
    return safeHashEqual(fingerprint?.sourceDigest, auditRun?.checkpoint?.sourceDigest)
        && Number(fingerprint?.scanned || 0) === approvedTotals.scanned
        && Number(fingerprint?.eligible || 0) === approvedTotals.eligible
        && Number(fingerprint?.skipped || 0) === approvedTotals.skipped;
};

const runTrustedDeviceV2Migration = async (rawOptions = {}, dependencies = {}) => {
    const options = validateRunOptions(rawOptions);
    const store = dependencies.store;
    const now = typeof dependencies.now === 'function'
        ? dependencies.now
        : () => new Date();
    if (!store) throw new TypeError('Migration store is required');

    const approval = options.mode === 'apply'
        ? await prepareApplyApproval({ options, store })
        : null;
    let existingRun = await store.getRun(options.runId);
    const sourceSnapshotAt = approval
        ? normalizeDate(approval.auditRun.sourceSnapshotAt)
        : normalizeDate(existingRun?.sourceSnapshotAt || options.sourceSnapshotAt || now());
    if (!sourceSnapshotAt) {
        throw createMigrationError('MIGRATION_SNAPSHOT_INVALID', 'sourceSnapshotAt must be a valid timestamp.');
    }
    const configHash = buildMigrationConfigHash({
        audience: options.audience,
        sourceSnapshotAt,
        batchSize: options.batchSize,
        maxErrorSamples: options.maxErrorSamples,
    });

    if (approval && !safeHashEqual(configHash, approval.auditRun.configHash)) {
        throw createMigrationError(
            'MIGRATION_APPROVAL_CONFIG_MISMATCH',
            'Apply configuration must exactly match the approved audit configuration.'
        );
    }
    if (existingRun) {
        if (
            existingRun.mode !== options.mode
            || existingRun.audience !== options.audience
            || !safeHashEqual(existingRun.configHash, configHash)
        ) {
            throw createMigrationError(
                'MIGRATION_RESUME_CONFIG_MISMATCH',
                'Existing migration run configuration does not match this invocation.'
            );
        }
        if (options.mode === 'apply'
            && !safeHashEqual(existingRun.approval?.changeTicketHash, approval.approvalHash)) {
            throw createMigrationError(
                'MIGRATION_RESUME_APPROVAL_MISMATCH',
                'Existing apply run approval does not match this invocation.'
            );
        }
        if (TERMINAL_STATUSES.has(existingRun.status)) {
            return buildMigrationEvidence(existingRun);
        }
    } else {
        const createdAt = now();
        existingRun = await store.createRun({
            runId: options.runId,
            mode: options.mode,
            audience: options.audience,
            status: 'planned',
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            requestedByHash: hmacSha256(
                options.pseudonymKey,
                `aura/trusted-device-v2/requested-by/${options.requestedBy}`
            ),
            configHash,
            sourceSnapshotAt,
            approval: options.mode === 'apply'
                ? {
                    approvedAt: createdAt,
                    approvedByHash: hmacSha256(
                        options.pseudonymKey,
                        `aura/trusted-device-v2/approved-by/${options.approvedBy}`
                    ),
                    changeTicketHash: approval.approvalHash,
                }
                : {},
            checkpoint: {
                lastUserId: null,
                batchNumber: 0,
                scannedCount: 0,
                sourceDigest: createInitialSourceDigest(),
                updatedAt: null,
            },
            totals: normalizeTotals(),
            errorSample: [],
        });
        if (
            !existingRun
            || existingRun.mode !== options.mode
            || existingRun.audience !== options.audience
            || !safeHashEqual(existingRun.configHash, configHash)
        ) {
            throw createMigrationError(
                'MIGRATION_RESUME_CONFIG_MISMATCH',
                'A concurrently created migration run does not match this invocation.'
            );
        }
        if (
            options.mode === 'apply'
            && !safeHashEqual(existingRun.approval?.changeTicketHash, approval.approvalHash)
        ) {
            throw createMigrationError(
                'MIGRATION_RESUME_APPROVAL_MISMATCH',
                'A concurrently created apply run approval does not match this invocation.'
            );
        }
    }

    const ownerIdentity = normalizeText(options.ownerId)
        || `${options.requestedBy}:${process.pid}`;
    const ownerHash = hmacSha256(
        options.pseudonymKey,
        `aura/trusted-device-v2/lease-owner/${ownerIdentity}`
    );
    const leaseMs = options.leaseSeconds * 1000;
    const acquiredAt = now();
    let run = await store.acquireLease({
        runId: options.runId,
        ownerHash,
        now: acquiredAt,
        leaseExpiresAt: new Date(acquiredAt.getTime() + leaseMs),
        startedAt: normalizeDate(existingRun.startedAt) || acquiredAt,
    });
    if (!run) {
        throw createMigrationError(
            'MIGRATION_LEASE_UNAVAILABLE',
            'Another worker currently owns the migration lease.'
        );
    }

    let totals = normalizeTotals(run.totals);
    let checkpoint = normalizeCheckpoint(run.checkpoint);
    let sourceDigest = checkpoint.sourceDigest;
    let errorSample = Array.isArray(run.errorSample)
        ? run.errorSample.slice(0, options.maxErrorSamples)
        : [];
    let batchesProcessed = 0;
    let exhaustedSource = false;

    try {
        if (approval) {
            // Full source-bound preflight happens before the first V2
            // credential write (and before every resume). The end-of-run
            // check remains as a race detector for changes during apply.
            const preflight = await inspectSourceFingerprint({
                store,
                options,
                sourceSnapshotAt,
                migrationRunId: approval.auditRun._id,
            });
            if (!sourceFingerprintMatchesApproval({
                fingerprint: preflight,
                auditRun: approval.auditRun,
            })) {
                throw createMigrationError(
                    'MIGRATION_SOURCE_DRIFT',
                    'Legacy trusted-device data changed after audit approval. No apply writes were started.'
                );
            }
        }

        while (batchesProcessed < options.maxBatches) {
            const users = await store.listSourceUsers({
                audience: options.audience,
                afterUserId: checkpoint.lastUserId,
                limit: options.batchSize + 1,
            });
            const hasMore = users.length > options.batchSize;
            const batchUsers = users.slice(0, options.batchSize);
            if (batchUsers.length === 0) {
                exhaustedSource = true;
                break;
            }

            const batchRecords = [];
            const recordSubjects = [];
            const seenRecordKeys = new Set();
            let batchScanned = 0;
            let batchEligible = 0;
            let batchSkipped = 0;
            let batchFailed = 0;
            let batchMigrated = 0;
            const recordedAt = now();

            batchUsers.forEach((user) => {
                const devices = Array.isArray(user?.trustedDevices) ? user.trustedDevices : [];
                devices.forEach((device, deviceIndex) => {
                    batchScanned += 1;
                    sourceDigest = extendSourceDigest({
                        previousDigest: sourceDigest,
                        user,
                        device,
                        deviceIndex,
                    });
                    let transformed;
                    try {
                        transformed = transformLegacyTrustedDevice({
                            user,
                            device,
                            deviceIndex,
                            migrationRunId: run._id,
                            sourceSnapshotAt,
                            pseudonymKey: options.pseudonymKey,
                        });
                    } catch {
                        const subjectHash = buildSubjectHash({
                            pseudonymKey: options.pseudonymKey,
                            userId: toIdString(user),
                            device,
                            deviceIndex,
                        });
                        transformed = {
                            subjectHash,
                            issue: sourceIssue({
                                subjectHash,
                                detailCode: 'transform_failed',
                            }),
                        };
                    }

                    if (transformed.issue) {
                        batchSkipped += 1;
                        errorSample = appendErrorSample(
                            errorSample,
                            transformed.issue,
                            recordedAt,
                            options.maxErrorSamples
                        );
                        return;
                    }

                    const recordKey = `${toIdString(user)}:${transformed.record.deviceIdHash}`;
                    if (seenRecordKeys.has(recordKey)) {
                        batchSkipped += 1;
                        errorSample = appendErrorSample(
                            errorSample,
                            sourceIssue({
                                subjectHash: transformed.subjectHash,
                                code: 'DUPLICATE_LEGACY_DEVICE',
                                detailCode: 'duplicate_user_device_hash',
                            }),
                            recordedAt,
                            options.maxErrorSamples
                        );
                        return;
                    }

                    seenRecordKeys.add(recordKey);
                    batchEligible += 1;
                    batchRecords.push(transformed.record);
                    recordSubjects.push(transformed.subjectHash);
                });
            });

            if (options.mode === 'apply' && batchRecords.length > 0) {
                const result = await store.upsertCredentials(batchRecords);
                const failures = Array.isArray(result?.failures) ? result.failures : [];
                batchMigrated = Math.max(Number(result?.successfulCount || 0), 0);
                batchFailed = failures.length;
                failures.forEach((failure) => {
                    const recordIndex = Number(failure?.index);
                    errorSample = appendErrorSample(
                        errorSample,
                        {
                            subjectHash: recordSubjects[recordIndex]
                                || hmacSha256(options.pseudonymKey, `unknown-record/${recordIndex}`),
                            code: failure?.code || 'TARGET_WRITE_FAILED',
                            detailCode: failure?.detailCode || 'bounded_write_error',
                        },
                        recordedAt,
                        options.maxErrorSamples
                    );
                });
            }

            totals = {
                scanned: totals.scanned + batchScanned,
                eligible: totals.eligible + batchEligible,
                migrated: totals.migrated + batchMigrated,
                skipped: totals.skipped + batchSkipped,
                failed: totals.failed + batchFailed,
            };
            const progressAt = now();
            checkpoint = {
                lastUserId: batchUsers[batchUsers.length - 1]._id,
                batchNumber: checkpoint.batchNumber + 1,
                scannedCount: totals.scanned,
                sourceDigest,
                updatedAt: progressAt,
            };
            run = await store.saveProgress({
                runId: options.runId,
                ownerHash,
                checkpoint,
                totals,
                errorSample,
                now: progressAt,
                leaseExpiresAt: new Date(progressAt.getTime() + leaseMs),
            });
            if (!run) {
                throw createMigrationError(
                    'MIGRATION_LEASE_LOST',
                    'Migration lease was lost before the checkpoint could be saved.'
                );
            }

            batchesProcessed += 1;
            if (!hasMore) {
                exhaustedSource = true;
                break;
            }
        }

        if (approval && exhaustedSource) {
            const approvedTotals = normalizeTotals(approval.auditRun.totals);
            const approvedSourceDigest = normalizeHash(approval.auditRun.checkpoint?.sourceDigest);
            const sourceMatchesApproval = safeHashEqual(sourceDigest, approvedSourceDigest)
                && totals.scanned === approvedTotals.scanned
                && totals.eligible === approvedTotals.eligible
                && totals.skipped === approvedTotals.skipped;
            if (!sourceMatchesApproval) {
                throw createMigrationError(
                    'MIGRATION_SOURCE_DRIFT',
                    'Legacy trusted-device data changed after audit approval. Roll back this apply run and audit again.'
                );
            }
        }

        const finishedAt = now();
        const status = exhaustedSource
            ? (totals.failed > 0 ? 'completed_with_errors' : 'completed')
            : 'paused';
        run = await store.finishRun({
            runId: options.runId,
            ownerHash,
            status,
            totals,
            errorSample,
            now: finishedAt,
        });
        if (!run) {
            throw createMigrationError(
                'MIGRATION_LEASE_LOST',
                'Migration lease was lost before final status could be saved.'
            );
        }
        return buildMigrationEvidence(run);
    } catch (error) {
        const failedAt = now();
        errorSample = appendErrorSample(
            errorSample,
            {
                subjectHash: hmacSha256(
                    options.pseudonymKey,
                    `aura/trusted-device-v2/fatal/${options.runId}`
                ),
                code: 'MIGRATION_FATAL',
                detailCode: normalizeDetailCode(error?.code, 'unexpected_failure'),
            },
            failedAt,
            options.maxErrorSamples
        );
        await store.failRun({
            runId: options.runId,
            ownerHash,
            totals,
            errorSample,
            now: failedAt,
        }).catch(() => null);
        throw error;
    }
};

module.exports = {
    EVIDENCE_VERSION,
    MAX_BATCH_SIZE,
    MAX_ERROR_SAMPLE_SIZE,
    MIGRATION_TRANSFORM_VERSION,
    buildAuditApprovalHash,
    buildCredentialUpsertOperations,
    buildMigrationConfigHash,
    buildMigrationEvidence,
    buildRollbackPlan,
    buildSourceUserFilter,
    createMongooseTrustedDeviceMigrationStore,
    inspectSourceFingerprint,
    runTrustedDeviceV2Migration,
    stableStringify,
    transformLegacyTrustedDevice,
};
