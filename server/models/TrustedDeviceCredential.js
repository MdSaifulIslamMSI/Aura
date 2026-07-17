const mongoose = require('mongoose');

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TRUSTED_DEVICE_CREDENTIAL_SCHEMA_VERSION = 2;
const CREDENTIAL_KINDS = Object.freeze(['browser_key', 'webauthn']);
const CREDENTIAL_PROVENANCE = Object.freeze([
    'legacy_backfill',
    'v2_enrollment',
    'v2_reverification',
    'operator_recovery',
]);
const CREDENTIAL_ASSURANCE = Object.freeze([
    'browser_bound',
    'passkey_legacy_unverified',
    'passkey_user_present',
    'passkey_user_verified',
    'passkey_hardware_bound',
]);
const CREDENTIAL_SCOPES = Object.freeze([
    'recognition',
    'mfa',
    'admin',
]);
const ENROLLMENT_CONTEXTS = Object.freeze([
    'device_recognition',
    'mfa_registration',
    'legacy_admin_snapshot',
    'admin_step_up',
    'operator_bootstrap',
]);
const ADMIN_ELIGIBILITY = Object.freeze([
    'none',
    'legacy_candidate',
    'verified',
]);
const CREDENTIAL_STATUSES = Object.freeze(['active', 'revoked']);

const trustedDeviceCredentialSchema = new mongoose.Schema({
    schemaVersion: {
        type: Number,
        enum: [TRUSTED_DEVICE_CREDENTIAL_SCHEMA_VERSION],
        default: TRUSTED_DEVICE_CREDENTIAL_SCHEMA_VERSION,
        required: true,
        immutable: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    credentialKind: {
        type: String,
        enum: CREDENTIAL_KINDS,
        required: true,
    },
    deviceIdHash: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
    browserKeyHash: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
    webauthnCredentialIdHash: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
    webauthnCredentialIdBase64Url: {
        type: String,
        default: null,
        trim: true,
        maxlength: 2048,
        select: false,
    },
    label: { type: String, default: '', trim: true, maxlength: 120 },
    algorithm: { type: String, required: true, trim: true, maxlength: 64 },
    publicKeySpkiBase64: {
        type: String,
        required: true,
        trim: true,
        maxlength: 16384,
        select: false,
    },
    webauthnTransports: {
        type: [{
            type: String,
            enum: ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'],
        }],
        default: [],
    },
    webauthnCounter: { type: Number, default: 0, min: 0 },
    webauthnUserVerification: {
        type: String,
        enum: ['required', 'preferred', 'discouraged', ''],
        default: '',
    },
    webauthnUserVerified: { type: Boolean, default: false },
    webauthnUserVerifiedAt: { type: Date, default: null },
    webauthnAaguid: { type: String, default: '', trim: true, maxlength: 64 },
    authenticatorAttachment: {
        type: String,
        enum: ['platform', 'cross-platform', ''],
        default: '',
    },
    backupEligible: { type: Boolean, default: false },
    backedUp: { type: Boolean, default: false },
    backupStateKnown: { type: Boolean, default: false },
    backupStateObservedAt: { type: Date, default: null },
    provenance: {
        type: String,
        enum: CREDENTIAL_PROVENANCE,
        required: true,
        default: 'v2_enrollment',
    },
    migrationRun: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TrustedDeviceMigrationRun',
        default: null,
    },
    legacyRecordHash: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
    credentialScope: {
        type: String,
        enum: CREDENTIAL_SCOPES,
        default: 'recognition',
        required: true,
    },
    enrollmentContext: {
        type: String,
        enum: ENROLLMENT_CONTEXTS,
        default: 'device_recognition',
        required: true,
    },
    adminEligibility: {
        type: String,
        enum: ADMIN_ELIGIBILITY,
        default: 'none',
        required: true,
    },
    adminEligibleAt: { type: Date, default: null },
    legacyAdminCandidateAt: { type: Date, default: null },
    assurance: {
        type: String,
        enum: CREDENTIAL_ASSURANCE,
        required: true,
    },
    status: {
        type: String,
        enum: CREDENTIAL_STATUSES,
        default: 'active',
        required: true,
    },
    sessionVersion: {
        type: String,
        required: true,
        trim: true,
        maxlength: 128,
        select: false,
    },
    lastSeenAt: { type: Date, default: null },
    lastVerifiedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revocationReasonCode: { type: String, default: '', trim: true, maxlength: 80 },
    revokedByHash: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
}, { timestamps: true });

trustedDeviceCredentialSchema.index(
    { user: 1, deviceIdHash: 1 },
    {
        unique: true,
        name: 'trusted_device_user_device_unique',
    }
);
trustedDeviceCredentialSchema.index(
    { user: 1, browserKeyHash: 1 },
    {
        unique: true,
        name: 'trusted_device_user_browser_key_unique',
        partialFilterExpression: {
            credentialKind: 'browser_key',
            browserKeyHash: { $type: 'string' },
        },
    }
);
trustedDeviceCredentialSchema.index(
    { webauthnCredentialIdHash: 1 },
    {
        unique: true,
        name: 'trusted_device_webauthn_credential_unique',
        partialFilterExpression: {
            credentialKind: 'webauthn',
            webauthnCredentialIdHash: { $type: 'string' },
        },
    }
);
trustedDeviceCredentialSchema.index(
    { user: 1, status: 1, lastVerifiedAt: -1 },
    { name: 'trusted_device_user_lifecycle' }
);
trustedDeviceCredentialSchema.index(
    { status: 1, expiresAt: 1 },
    { name: 'trusted_device_expiration_review' }
);
trustedDeviceCredentialSchema.index(
    { migrationRun: 1 },
    {
        name: 'trusted_device_migration_run',
        partialFilterExpression: { migrationRun: { $type: 'objectId' } },
    }
);

trustedDeviceCredentialSchema.pre('validate', function validateCredentialShape() {
    const isBrowserKey = this.credentialKind === 'browser_key';
    const isWebAuthn = this.credentialKind === 'webauthn';

    if (isBrowserKey && !this.browserKeyHash) {
        this.invalidate('browserKeyHash', 'browserKeyHash is required for browser_key credentials');
    }
    if (isBrowserKey && (this.webauthnCredentialIdHash || this.webauthnCredentialIdBase64Url)) {
        this.invalidate(
            'webauthnCredentialIdHash',
            'browser_key credentials cannot contain WebAuthn credential identifiers'
        );
    }
    if (isBrowserKey && this.assurance !== 'browser_bound') {
        this.invalidate('assurance', 'browser_key credentials must use browser_bound assurance');
    }
    if (isBrowserKey && (this.webauthnUserVerified || this.webauthnUserVerifiedAt)) {
        this.invalidate('webauthnUserVerified', 'browser_key credentials cannot record WebAuthn user verification');
    }

    if (isWebAuthn && !this.webauthnCredentialIdHash) {
        this.invalidate(
            'webauthnCredentialIdHash',
            'webauthnCredentialIdHash is required for webauthn credentials'
        );
    }
    if (isWebAuthn && !this.webauthnCredentialIdBase64Url) {
        this.invalidate(
            'webauthnCredentialIdBase64Url',
            'webauthnCredentialIdBase64Url is required for webauthn credentials'
        );
    }
    if (isWebAuthn && this.assurance === 'browser_bound') {
        this.invalidate('assurance', 'webauthn credentials require passkey assurance');
    }
    if (
        isWebAuthn
        && this.provenance === 'legacy_backfill'
        && this.assurance !== 'passkey_legacy_unverified'
    ) {
        this.invalidate('assurance', 'legacy WebAuthn backfills must remain unverified until fresh assertion');
    }
    if (
        isWebAuthn
        && ['passkey_user_verified', 'passkey_hardware_bound'].includes(this.assurance)
        && (!this.webauthnUserVerified || !this.webauthnUserVerifiedAt)
    ) {
        this.invalidate('webauthnUserVerified', 'verified passkey assurance requires an observed WebAuthn UV event');
    }
    if (
        isWebAuthn
        && ['passkey_legacy_unverified', 'passkey_user_present'].includes(this.assurance)
        && (this.webauthnUserVerified || this.webauthnUserVerifiedAt)
    ) {
        this.invalidate('webauthnUserVerified', 'unverified passkey assurance cannot record WebAuthn UV');
    }
    if (
        this.assurance === 'passkey_user_present'
        && (
            this.credentialScope !== 'recognition'
            || this.adminEligibility !== 'none'
        )
    ) {
        this.invalidate('assurance', 'user-present passkeys are recognition-only and cannot satisfy MFA or admin policy');
    }
    if (
        this.assurance === 'passkey_legacy_unverified'
        && this.provenance !== 'legacy_backfill'
    ) {
        this.invalidate('assurance', 'unverified passkey assurance is limited to legacy backfills');
    }

    if (
        this.adminEligibility === 'verified'
        && (
            !isWebAuthn
            || !['passkey_user_verified', 'passkey_hardware_bound'].includes(this.assurance)
            || !this.webauthnUserVerified
            || !this.webauthnUserVerifiedAt
            || this.webauthnUserVerification !== 'required'
            || this.credentialScope !== 'admin'
            || !this.adminEligibleAt
        )
    ) {
        this.invalidate(
            'adminEligibility',
            'verified admin credentials must be admin-scoped, user-verified WebAuthn credentials with verification time'
        );
    }
    if (this.adminEligibility === 'legacy_candidate') {
        if (
            !isWebAuthn
            || this.provenance !== 'legacy_backfill'
            || this.credentialScope !== 'recognition'
            || this.enrollmentContext !== 'legacy_admin_snapshot'
            || !this.legacyAdminCandidateAt
            || this.adminEligibleAt
        ) {
            this.invalidate(
                'adminEligibility',
                'legacy admin candidates must remain recognition-only legacy WebAuthn records until fresh verification'
            );
        }
    }
    if (this.adminEligibility === 'none' && (this.adminEligibleAt || this.legacyAdminCandidateAt)) {
        this.invalidate(
            'adminEligibility',
            'non-admin credentials cannot record admin eligibility timestamps'
        );
    }
    if (this.adminEligibility !== 'verified' && this.credentialScope === 'admin') {
        this.invalidate('credentialScope', 'admin scope requires verified admin eligibility');
    }
    if (isBrowserKey && (
        this.credentialScope !== 'recognition'
        || this.enrollmentContext !== 'device_recognition'
        || this.adminEligibility !== 'none'
    )) {
        this.invalidate(
            'credentialScope',
            'browser_key credentials are recognition-only and cannot be MFA or admin credentials'
        );
    }
    if (this.provenance === 'legacy_backfill' && !this.migrationRun) {
        this.invalidate('migrationRun', 'legacy_backfill credentials must reference a migration run');
    }

    if (this.status === 'revoked' && !this.revokedAt) {
        this.invalidate('revokedAt', 'revoked credentials must record revokedAt');
    }
    if (this.status === 'revoked' && !this.revocationReasonCode) {
        this.invalidate('revocationReasonCode', 'revoked credentials must record a reason code');
    }
    if (this.status === 'active' && this.revokedAt) {
        this.invalidate('revokedAt', 'active credentials cannot record revokedAt');
    }
    if (this.backedUp && !this.backupEligible) {
        this.invalidate('backedUp', 'backedUp credentials must also be backupEligible');
    }
    if (!this.backupStateKnown && (this.backupEligible || this.backedUp || this.backupStateObservedAt)) {
        this.invalidate('backupStateKnown', 'unknown backup state cannot record backup flags or observation time');
    }
    if (this.backupStateKnown && !this.backupStateObservedAt) {
        this.invalidate('backupStateObservedAt', 'known backup state requires an observation time');
    }
});

const TrustedDeviceCredential = mongoose.models.TrustedDeviceCredential
    || mongoose.model('TrustedDeviceCredential', trustedDeviceCredentialSchema);

module.exports = TrustedDeviceCredential;
module.exports.constants = Object.freeze({
    ADMIN_ELIGIBILITY,
    CREDENTIAL_ASSURANCE,
    CREDENTIAL_KINDS,
    CREDENTIAL_PROVENANCE,
    CREDENTIAL_SCOPES,
    CREDENTIAL_STATUSES,
    ENROLLMENT_CONTEXTS,
    TRUSTED_DEVICE_CREDENTIAL_SCHEMA_VERSION,
});
