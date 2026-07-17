const mongoose = require('mongoose');
const TrustedDeviceCredential = require('../models/TrustedDeviceCredential');
const TrustedDeviceMigrationRun = require('../models/TrustedDeviceMigrationRun');

const hash = (character) => character.repeat(64);

const browserCredential = (overrides = {}) => new TrustedDeviceCredential({
    user: new mongoose.Types.ObjectId(),
    credentialKind: 'browser_key',
    deviceIdHash: hash('a'),
    browserKeyHash: hash('b'),
    algorithm: 'RSA-PSS-SHA256',
    publicKeySpkiBase64: 'fixture-public-key',
    provenance: 'v2_enrollment',
    credentialScope: 'recognition',
    enrollmentContext: 'device_recognition',
    adminEligibility: 'none',
    assurance: 'browser_bound',
    sessionVersion: 'fixture-session-version',
    ...overrides,
});

describe('TrustedDeviceCredential schema', () => {
    test('uses hashed lookup indexes without a destructive TTL index', () => {
        const indexes = TrustedDeviceCredential.schema.indexes();

        expect(indexes).toEqual(expect.arrayContaining([
            expect.arrayContaining([
                { user: 1, deviceIdHash: 1 },
                expect.objectContaining({
                    unique: true,
                }),
            ]),
            expect.arrayContaining([
                { webauthnCredentialIdHash: 1 },
                expect.objectContaining({
                    unique: true,
                    partialFilterExpression: expect.objectContaining({ credentialKind: 'webauthn' }),
                }),
            ]),
        ]));
        const deviceIndex = indexes.find(([keys]) => (
            keys.user === 1 && keys.deviceIdHash === 1
        ));
        expect(deviceIndex[1]).not.toHaveProperty('partialFilterExpression');
        expect(indexes.some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
        expect(TrustedDeviceCredential.schema.path('deviceIdHash').options.select).toBe(false);
        expect(TrustedDeviceCredential.schema.path('sessionVersion').options.select).toBe(false);
    });

    test('accepts a browser credential with an opaque session version', async () => {
        const credential = browserCredential();

        await expect(credential.validate()).resolves.toBeUndefined();
        expect(credential.schemaVersion).toBe(2);
        expect(credential.status).toBe('active');
    });

    test('accepts an admin-eligible user-verified WebAuthn credential', async () => {
        const credential = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            webauthnUserVerification: 'required',
            webauthnUserVerified: true,
            webauthnUserVerifiedAt: new Date(),
            authenticatorAttachment: 'platform',
            credentialScope: 'admin',
            enrollmentContext: 'admin_step_up',
            adminEligibility: 'verified',
            adminEligibleAt: new Date(),
            assurance: 'passkey_user_verified',
        });

        await expect(credential.validate()).resolves.toBeUndefined();
    });

    test('rejects browser keys as admin-eligible credentials', async () => {
        const credential = browserCredential({
            credentialScope: 'admin',
            enrollmentContext: 'admin_step_up',
            adminEligibility: 'verified',
            adminEligibleAt: new Date(),
        });

        await expect(credential.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ credentialScope: expect.anything() }),
        });
    });

    test('requires explicit user verification for admin-eligible passkeys', async () => {
        const credential = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            webauthnUserVerification: 'preferred',
            webauthnUserVerified: false,
            credentialScope: 'admin',
            enrollmentContext: 'admin_step_up',
            adminEligibility: 'verified',
            adminEligibleAt: new Date(),
            assurance: 'passkey_user_verified',
        });

        await expect(credential.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ adminEligibility: expect.anything() }),
        });
    });

    test('keeps legacy admin snapshots as unverified recognition candidates', async () => {
        const credential = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            assurance: 'passkey_legacy_unverified',
            provenance: 'legacy_backfill',
            migrationRun: new mongoose.Types.ObjectId(),
            credentialScope: 'recognition',
            enrollmentContext: 'legacy_admin_snapshot',
            adminEligibility: 'legacy_candidate',
            legacyAdminCandidateAt: new Date(),
        });

        await expect(credential.validate()).resolves.toBeUndefined();
        expect(credential.adminEligibility).toBe('legacy_candidate');
        expect(credential.credentialScope).toBe('recognition');
    });

    test('rejects direct promotion of a legacy candidate without fresh admin verification', async () => {
        const credential = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            assurance: 'passkey_legacy_unverified',
            provenance: 'legacy_backfill',
            migrationRun: new mongoose.Types.ObjectId(),
            credentialScope: 'admin',
            enrollmentContext: 'legacy_admin_snapshot',
            adminEligibility: 'legacy_candidate',
            legacyAdminCandidateAt: new Date(),
        });

        await expect(credential.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ adminEligibility: expect.anything() }),
        });
    });

    test('requires an auditable revocation timestamp and migration provenance', async () => {
        const revoked = browserCredential({ status: 'revoked' });
        const backfilled = browserCredential({ provenance: 'legacy_backfill' });

        await expect(revoked.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ revokedAt: expect.anything() }),
        });
        await expect(backfilled.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ migrationRun: expect.anything() }),
        });
    });

    test('requires observed backup evidence before recording synced passkey state', async () => {
        const unknownBackupState = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            assurance: 'passkey_user_verified',
            webauthnUserVerification: 'required',
            webauthnUserVerified: true,
            webauthnUserVerifiedAt: new Date(),
            backupEligible: true,
            backedUp: true,
        });
        const observedBackupState = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            assurance: 'passkey_user_verified',
            webauthnUserVerification: 'required',
            webauthnUserVerified: true,
            webauthnUserVerifiedAt: new Date(),
            backupEligible: true,
            backedUp: true,
            backupStateKnown: true,
            backupStateObservedAt: new Date(),
        });

        await expect(unknownBackupState.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ backupStateKnown: expect.anything() }),
        });
        await expect(observedBackupState.validate()).resolves.toBeUndefined();
    });

    test('keeps a user-present passkey recognition-only', async () => {
        const credential = browserCredential({
            credentialKind: 'webauthn',
            browserKeyHash: null,
            webauthnCredentialIdHash: hash('c'),
            webauthnCredentialIdBase64Url: 'fixture-credential-id',
            algorithm: 'ES256',
            webauthnUserVerification: 'preferred',
            assurance: 'passkey_user_present',
            credentialScope: 'mfa',
            enrollmentContext: 'mfa_registration',
        });

        await expect(credential.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ assurance: expect.anything() }),
        });
    });
});

describe('TrustedDeviceMigrationRun schema', () => {
    const baseRun = (overrides = {}) => new TrustedDeviceMigrationRun({
        runId: 'trusted-device-v2-fixture-run',
        requestedByHash: hash('d'),
        configHash: hash('e'),
        ...overrides,
    });

    test('defines resumable state and lease indexes without automatic deletion', () => {
        const indexes = TrustedDeviceMigrationRun.schema.indexes();

        expect(indexes).toEqual(expect.arrayContaining([
            expect.arrayContaining([
                { runId: 1 },
                expect.objectContaining({ unique: true }),
            ]),
            expect.arrayContaining([
                { 'lock.leaseExpiresAt': 1, status: 1 },
                expect.any(Object),
            ]),
        ]));
        expect(indexes.some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
        expect(TrustedDeviceMigrationRun.schema.path('checkpoint.lastUserId')).toBeDefined();
        expect(TrustedDeviceMigrationRun.schema.path('checkpoint.batchNumber')).toBeDefined();
        expect(TrustedDeviceMigrationRun.schema.path('checkpoint.sourceDigest')).toBeDefined();
    });

    test('defaults to a non-mutating planned audit', async () => {
        const run = baseRun();

        await expect(run.validate()).resolves.toBeUndefined();
        expect(run.schemaVersion).toBe(2);
        expect(run.mode).toBe('audit');
        expect(run.status).toBe('planned');
        expect(run.targetSchemaVersion).toBe(2);
    });

    test('requires approval evidence for apply mode', async () => {
        const run = baseRun({ mode: 'apply' });

        await expect(run.validate()).rejects.toMatchObject({
            errors: expect.objectContaining({ approval: expect.anything() }),
        });
    });

    test('accepts an approved resumable apply run with a bounded checkpoint', async () => {
        const now = new Date();
        const run = baseRun({
            mode: 'apply',
            status: 'paused',
            approval: {
                approvedAt: now,
                approvedByHash: hash('f'),
                changeTicketHash: hash('1'),
            },
            checkpoint: {
                lastUserId: new mongoose.Types.ObjectId(),
                batchNumber: 3,
                scannedCount: 30,
                updatedAt: now,
            },
            totals: {
                scanned: 30,
                eligible: 25,
                migrated: 20,
                skipped: 5,
                failed: 0,
            },
            startedAt: now,
        });

        await expect(run.validate()).resolves.toBeUndefined();
    });
});
