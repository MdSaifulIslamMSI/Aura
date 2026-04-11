const mongoose = require('mongoose');

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
    label: { type: String, default: '' },
    method: { type: String, enum: ['browser_key', 'webauthn'], default: 'browser_key' },
    algorithm: { type: String, default: 'RSA-PSS-SHA256' },
    publicKeySpkiBase64: { type: String, required: true },
    webauthnCredentialIdBase64Url: { type: String, default: '' },
    webauthnTransports: { type: [String], default: [] },
    webauthnCounter: { type: Number, default: 0, min: 0 },
    webauthnUserVerification: { type: String, default: 'required' },
    webauthnAaguid: { type: String, default: '' },
    authenticatorAttachment: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastVerifiedAt: { type: Date, default: Date.now },
}, { _id: false });

const userSchema = mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    authUid: { type: String, trim: true },
    phone: { type: String, required: false, set: normalizeOptionalPhone },
    avatar: { type: String, default: '' },           // URL or data URI
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer-not-to-say', ''], default: '' },
    dob: { type: Date, default: null },
    bio: { type: String, default: '', maxlength: 200 },
    isAdmin: { type: Boolean, required: true, default: false },
    isVerified: { type: Boolean, default: false },
    authAssurance: {
        type: String,
        enum: ['none', 'password', 'otp', 'password+otp'],
        default: 'none',
        index: true,
    },
    authAssuranceAt: { type: Date, default: null },
    authAssuranceAuthTime: { type: Number, default: null, select: false },
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
    loyalty: { type: loyaltySchema, default: () => ({}) }
}, {
    timestamps: true
});

// ── Indexes ──────────────────────────────────────────────────
// NOTE: OTP lifecycle TTL is handled by OtpSession model, not User documents.

// Unique phone only when a non-empty phone number is present.
userSchema.index(
    { phone: 1 },
    {
        unique: true,
        name: 'phone_1_partial_unique_nonempty',
        partialFilterExpression: {
            $and: [
                { phone: { $exists: true } },
                { phone: { $type: 'string' } },
                { phone: { $gt: '' } },
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

// Compound index for the most frequent query pattern: phone + isVerified
// Used by checkUserExists, sendOtp (login/forgot-password), verifyOtp
userSchema.index({ phone: 1, isVerified: 1 });

// Index for authMiddleware email lookup (most called path)
userSchema.index({ email: 1, isVerified: 1 });

// Fast seller-visibility checks for marketplace controls.
userSchema.index({ isSeller: 1, isVerified: 1 });

// Account governance + enforcement checks.
userSchema.index({ accountState: 1, softDeleted: 1, 'moderation.suspendedUntil': 1 });

// Support leaderboard/reward dashboards.
userSchema.index({ 'loyalty.pointsBalance': -1, isVerified: 1 });

module.exports = mongoose.model('User', userSchema);
