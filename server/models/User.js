const mongoose = require('mongoose');

const { defineEncryptedField } = require('./utils/encryptedField');
const { computePhoneBlindIndexV2 } = require('../services/blindIndexService');

const normalizeOptionalPhone = (value) => {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized ? normalized : undefined;
};

const wishlistItemSchema = mongoose.Schema({
    id: { type: Number, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true },
    originalPrice: { type: Number },
    discountPercentage: { type: Number },
    image: { type: String, required: true },
    brand: { type: String },
    rating: { type: Number },
    ratingCount: { type: Number },
    stock: { type: Number },
    deliveryTime: { type: String },
    category: { type: String },
    addedAt: { type: Date, default: Date.now }
}, { _id: false });

const loyaltyLedgerSchema = mongoose.Schema({
    eventType: {
        type: String,
        enum: ['daily_login', 'order_placed', 'listing_created', 'manual_adjustment'],
        required: true,
    },
    points: { type: Number, required: true },
    reason: { type: String, default: '' },
    refType: {
        type: String,
        enum: ['order', 'listing', 'system', 'admin'],
        default: 'system',
    },
    refId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });

const loyaltySchema = mongoose.Schema({
    pointsBalance: { type: Number, default: 0, min: 0 },
    lifetimeEarned: { type: Number, default: 0, min: 0 },
    lifetimeSpent: { type: Number, default: 0, min: 0 },
    streakDays: { type: Number, default: 0, min: 0 },
    tier: {
        type: String,
        enum: ['Rookie', 'Pro', 'Elite', 'Legend', 'Mythic'],
        default: 'Rookie',
    },
    nextMilestone: { type: Number, default: 500, min: 0 },
    lastEarnedAt: { type: Date, default: null },
    lastDailyRewardAt: { type: Date, default: null },
    ledger: { type: [loyaltyLedgerSchema], default: [] },
}, { _id: false });

const trustedDeviceSchema = mongoose.Schema({
    deviceId: { type: String, required: true },
    deviceIdHash: { type: String, default: '' },
    userAgentHash: { type: String, default: '' },
    label: { type: String, default: '' },
    method: { type: String, enum: ['browser_key', 'webauthn'], default: 'browser_key' },
    algorithm: { type: String, default: 'RSA-PSS-SHA256' },
    publicKeySpkiBase64: { type: String, required: true },
    webauthnCredentialIdBase64Url: { type: String, default: '' },
    webauthnTransports: { type: [String], default: [] },
    webauthnCounter: { type: Number, default: 0, min: 0 },
    webauthnUserVerification: { type: String, default: 'required' },
    // Null identifies pre-overhaul records whose historical UV bit was not
    // stored separately from the requested WebAuthn policy.
    webauthnUserVerified: { type: Boolean, default: null },
    webauthnUserVerifiedAt: { type: Date, default: null },
    webauthnAaguid: { type: String, default: '' },
    webauthnBackupEligible: { type: Boolean, default: false },
    webauthnBackedUp: { type: Boolean, default: false },
    webauthnBackupStateObservedAt: { type: Date, default: null },
    authenticatorAttachment: { type: String, default: '' },
    credentialScope: {
        type: String,
        enum: ['recognition', 'mfa', 'admin'],
        default: 'recognition',
    },
    enrollmentContext: {
        type: String,
        enum: ['device_recognition', 'mfa_registration', 'legacy_admin_snapshot', 'admin_step_up', 'operator_bootstrap'],
        default: 'device_recognition',
    },
    adminEligibility: {
        type: String,
        enum: ['none', 'legacy_candidate', 'verified'],
        default: 'none',
    },
    adminEligibleAt: { type: Date, default: null },
    legacyAdminCandidateAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastVerifiedAt: { type: Date, default: Date.now },
    sessionVersion: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
}, { _id: false });

const recoveryCodeSchema = mongoose.Schema({
    codeHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    usedAt: { type: Date, default: null },
    usedFor: { type: String, default: '' },
}, { _id: false });

const mfaPasskeySchema = mongoose.Schema({
    credentialId: { type: String, default: '' },
    publicKey: { type: String, default: '', select: false },
    counter: { type: Number, default: 0, min: 0 },
    transports: { type: [String], default: [] },
    deviceType: { type: String, default: '' },
    backupEligible: { type: Boolean, default: false },
    backedUp: { type: Boolean, default: false },
    name: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
}, { _id: false });

const mfaRecoveryCodeSchema = mongoose.Schema({
    codeHash: { type: String, default: '', select: false },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });

const mfaSchema = mongoose.Schema({
    enabled: { type: Boolean, default: false },
    defaultMethod: { type: String, enum: ['passkey', 'totp', ''], default: '' },
    requiredByPolicy: { type: Boolean, default: false },
    totp: {
        enabled: { type: Boolean, default: false },
        secretEncrypted: { type: String, default: null, select: false },
        pendingSecretEncrypted: { type: String, default: null, select: false },
        pendingCreatedAt: { type: Date, default: null },
        confirmedAt: { type: Date, default: null },
        lastVerifiedAt: { type: Date, default: null },
        disabledAt: { type: Date, default: null },
    },
    passkeys: { type: [mfaPasskeySchema], default: [] },
    recoveryCodes: { type: [mfaRecoveryCodeSchema], default: [] },
    lastMfaAt: { type: Date, default: null },
    lastMfaMethod: { type: String, enum: ['passkey', 'totp', 'recovery_code', 'email_otp', ''], default: '' },
}, { _id: false });

const userSchema = mongoose.Schema({
    accountCenterSchemaVersion: { type: Number, default: 2, min: 1, max: 2 },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    authUid: { type: String, trim: true },
    phone: { type: String, required: false, set: normalizeOptionalPhone },
    // Legacy v1 HMAC blind index (bare-HMAC derivation). FROZEN: no longer
    // written or queried since the step-4 retirement — kept only so historical
    // rows stay interpretable and pre-retirement rollback builds can read them.
    phoneHash: { type: String, required: false, default: null, select: false },
    // v2 blind index (HKDF-derived): the live equality-lookup and uniqueness
    // surface for the encrypted phone. See services/blindIndexService.js.
    phoneHashV2: { type: String, required: false, default: null, select: false },
    avatar: { type: String, default: '' },           // Durable URL, with legacy data-URI read fallback during migration
    avatarMedia: {
        storageKey: { type: String, default: '' },
        storageDriver: { type: String, enum: ['local', 's3', ''], default: '' },
        mimeType: { type: String, default: '' },
        sizeBytes: { type: Number, default: 0, min: 0 },
        width: { type: Number, default: 0, min: 0 },
        height: { type: Number, default: 0, min: 0 },
        updatedAt: { type: Date, default: null },
    },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer-not-to-say', ''], default: '' },
    dob: { type: Date, default: null },
    bio: { type: String, default: '', maxlength: 200 },
    isAdmin: { type: Boolean, required: true, default: false },
    adminRoles: {
        type: [String],
        enum: ['ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
        default: [],
        index: true,
    },
    isVerified: { type: Boolean, default: false },
    authAssurance: {
        type: String,
        enum: ['none', 'password', 'otp', 'password+otp'],
        default: 'none',
        index: true,
    },
    authAssuranceAt: { type: Date, default: null },
    authAssuranceAuthTime: { type: Number, default: null, select: false },
    authTokensRevokedAfter: { type: Date, default: null, index: true },
    adminSecurityVersion: { type: Number, default: 0, min: 0, index: true },
    isSeller: { type: Boolean, default: false },
    sellerActivatedAt: { type: Date, default: null },
    accountState: {
        type: String,
        enum: ['active', 'warned', 'suspended', 'deleted'],
        default: 'active',
        index: true,
    },
    softDeleted: { type: Boolean, default: false, index: true },
    moderation: {
        warningCount: { type: Number, default: 0, min: 0 },
        lastWarningAt: { type: Date, default: null },
        lastWarningReason: { type: String, default: '', maxlength: 500 },
        suspensionCount: { type: Number, default: 0, min: 0 },
        suspendedAt: { type: Date, default: null },
        suspendedUntil: { type: Date, default: null, index: true },
        suspensionReason: { type: String, default: '', maxlength: 500 },
        suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reactivatedAt: { type: Date, default: null },
        reactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        deleteReason: { type: String, default: '', maxlength: 500 },
    },
    // OTP fields — all excluded from normal queries
    otp: { type: String, default: null, select: false },        // bcrypt hash of OTP
    otpExpiry: { type: Date, default: null, select: false },
    otpPurpose: { type: String, enum: ['signup', 'login', 'forgot-password', 'payment-challenge', null], default: null, select: false },
    otpAttempts: { type: Number, default: 0, select: false },    // wrong attempts (max 5)
    otpLockedUntil: { type: Date, default: null, select: false },// lockout expiry
    signupEmailOtpVerifiedAt: { type: Date, default: null, select: false },
    loginEmailOtpVerifiedAt: { type: Date, default: null, select: false },
    loginOtpVerifiedAt: { type: Date, default: null, select: false },
    loginOtpAssuranceExpiresAt: { type: Date, default: null, select: false },
    resetEmailOtpVerifiedAt: { type: Date, default: null, select: false },
    resetOtpVerifiedAt: { type: Date, default: null, select: false },
    trustedDevices: { type: [trustedDeviceSchema], default: [] },
    recoveryCodes: { type: [recoveryCodeSchema], default: [], select: false },
    recoveryCodeState: {
        generatedAt: { type: Date, default: null },
        lastUsedAt: { type: Date, default: null },
        activeCount: { type: Number, default: 0, min: 0 },
    },
    mfa: { type: mfaSchema, default: () => ({}) },
    addresses: [{
        type: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
        name: { type: String, required: true },
        phone: { type: String, required: true },
        address: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        pincode: { type: String, required: true },
        isDefault: { type: Boolean, default: false }
    }],
    wishlist: [wishlistItemSchema],
    wishlistRevision: { type: Number, default: 0, min: 0 },
    wishlistSyncedAt: { type: Date, default: null },
    // Gross lifetime order spend, maintained incrementally on order placement.
    // Matches the legacy dashboard aggregate semantics: sum of totalPrice over
    // ALL orders (including cancelled), in base currency units. Recomputed
    // absolutely by scripts/backfill-lifetime-spent.js — never adjusted by
    // refunds, which have their own refundSummary trail on each order.
    lifetimeSpent: { type: Number, default: 0, min: 0 },
    // Authoritative integer-paise accumulator summed from Order.totalPriceMinor;
    // the float major above is kept only until every reader has migrated.
    lifetimeSpentMinor: { type: Number, default: 0, min: 0 },
    loyalty: { type: loyaltySchema, default: () => ({}) }
}, {
    timestamps: true
});

// ── Indexes ──────────────────────────────────────────────────
// NOTE: OTP lifecycle TTL is handled by OtpSession model, not User documents.

// No index on the raw phone: at rest it is IV-randomized ciphertext, so a
// unique index on it never conflicts (it enforces nothing) and equality
// lookups cannot target it. Duplicate-phone uniqueness lives on phoneHashV2
// below, which hashes the plaintext before encryption.

// Equality-searchable identity for the encrypted phone: an HMAC blind index.
// Deterministic, so uniqueness of the hash == uniqueness of the stored phone,
// and `phoneHash: { $in: hashes }` mirrors `phone: { $in: values }` exactly.
//
// v1 (bare-HMAC phoneHash) carried this backstop until the v2 rollout. The v1
// indexes were dropped after the backfill proved 0 duplicates and 0 coverage
// gaps (migration 2026-10-09-drop-blind-index-v1-indexes); the HKDF-derived
// phoneHashV2 below carries uniqueness now. The v1 *field* is still
// dual-written and dual-read so rollback stays possible — only the indexes
// are gone.
userSchema.index(
    { phoneHashV2: 1 },
    {
        unique: true,
        name: 'phoneHashV2_1_partial_unique_nonempty',
        partialFilterExpression: {
            $and: [
                { phoneHashV2: { $exists: true } },
                { phoneHashV2: { $type: 'string' } },
                { phoneHashV2: { $gt: '' } },
            ],
        },
    }
);

// Stable Firebase identity for providers that don't expose an email address.
userSchema.index(
    { authUid: 1 },
    {
        unique: true,
        name: 'auth_uid_1_partial_unique_nonempty',
        partialFilterExpression: {
            $and: [
                { authUid: { $exists: true } },
                { authUid: { $type: 'string' } },
                { authUid: { $gt: '' } },
            ],
        },
    }
);

// Compound index for the most frequent query pattern: phoneHashV2 + isVerified
// (login/forgot-password/signup lookups via buildPhoneMatchFilter). The legacy
// phone and phoneHash compounds are gone: plaintext phone is ciphertext here
// (an unindexed collscan that can never match), and the v1 hash was retired
// with the step-4 migration.
userSchema.index({ phoneHashV2: 1, isVerified: 1 });

// Index for authMiddleware email lookup (most called path)
userSchema.index({ email: 1, isVerified: 1 });

// Fast seller-visibility checks for marketplace controls.
userSchema.index({ isSeller: 1, isVerified: 1 });

// Account governance + enforcement checks.
userSchema.index({ accountState: 1, softDeleted: 1, 'moderation.suspendedUntil': 1 });

// Support leaderboard/reward dashboards.
userSchema.index({ 'loyalty.pointsBalance': -1, isVerified: 1 });

// PII at rest: the address book identity fields and the account phone are
// encrypted; phoneHash (HMAC blind index) keeps equality lookups and the
// uniqueness constraint working on ciphertext.
const addressSchema = userSchema.path('addresses').schema;
defineEncryptedField(addressSchema, 'name');
defineEncryptedField(addressSchema, 'phone');
defineEncryptedField(addressSchema, 'address');
defineEncryptedField(userSchema, 'phone');

// Keep phoneHashV2 in lockstep with phone on every write path. save() flows run
// through validation; update flows (findOneAndUpdate/updateOne with $set or
// $unset on phone) are patched here so call sites never maintain the hash.
// Hash the POST-setter value so the index always matches what is stored.
// The legacy v1 phoneHash is no longer written (step-4 retirement); the
// $unset branch below still clears a stale one alongside the live v2 hash.
const syncPhoneHashV2FromPhone = (phone) => computePhoneBlindIndexV2(normalizeOptionalPhone(phone));

userSchema.pre('validate', function syncPhoneHashValidate() {
    this.phoneHashV2 = syncPhoneHashV2FromPhone(this.phone);
});

const syncPhoneHashInUpdate = (query) => {
    const update = query.getUpdate() || {};
    // mongoose 9 casts timestamps into $set before hooks run, so the update can
    // be MIXED (flat phone alongside a $set doc). Patch the hash in the same
    // shape wherever the phone itself lives — in-place mutation survives.
    if (Object.prototype.hasOwnProperty.call(update, 'phone')) {
        update.phoneHashV2 = syncPhoneHashV2FromPhone(update.phone);
    }
    if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'phone')) {
        update.$set.phoneHashV2 = syncPhoneHashV2FromPhone(update.$set.phone);
    }
    // Clearing the phone must clear both hashes, or the row stays findable by a
    // number the account no longer owns.
    if (update.$unset && Object.prototype.hasOwnProperty.call(update.$unset, 'phone')
        && !Object.prototype.hasOwnProperty.call(update.$unset, 'phoneHash')) {
        update.$unset.phoneHash = '';
        update.$unset.phoneHashV2 = '';
    }
    return query;
};

userSchema.pre('findOneAndUpdate', function syncPhoneHashFindOneAndUpdate() {
    syncPhoneHashInUpdate(this);
});
// Explicit query scoping: with default options mongoose 9 only binds these to
// document middleware, so Model.updateOne()/updateMany() would skip the hook.
userSchema.pre('updateOne', { document: false, query: true }, function syncPhoneHashUpdateOne() {
    syncPhoneHashInUpdate(this);
});
userSchema.pre('updateMany', { document: false, query: true }, function syncPhoneHashUpdateMany() {
    syncPhoneHashInUpdate(this);
});

module.exports = mongoose.model('User', userSchema);
