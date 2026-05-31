const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../../models/User');
const Product = require('../../models/Product');
const Order = require('../../models/Order');
const PaymentIntent = require('../../models/PaymentIntent');
const PaymentEvent = require('../../models/PaymentEvent');
const PaymentMethod = require('../../models/PaymentMethod');
const { PAYMENT_STATUSES } = require('../../services/payments/constants');

const SAFE_STATUS_CODES = new Set([400, 401, 403, 404, 409, 422, 423, 429]);

const randomSuffix = (label = 'security') => `${label}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
const randomEmail = (label = 'security') => `${randomSuffix(label)}@example.test`;
const randomPhone = () => `+91${String(crypto.randomInt(0, 10_000_000_000)).padStart(10, '0')}`;
const objectId = () => new mongoose.Types.ObjectId();

const assertSafeStatus = (response, expected = SAFE_STATUS_CODES) => {
    const allowed = expected instanceof Set ? expected : new Set(Array.isArray(expected) ? expected : [expected]);
    expect(allowed.has(response.statusCode)).toBe(true);
};

const serializeDoc = (doc) => JSON.parse(JSON.stringify(doc || null));

const expectDocumentUnchanged = async (Model, id, before) => {
    const after = await Model.findById(id).lean();
    expect(serializeDoc(after)).toEqual(serializeDoc(before));
};

const createTestUser = (overrides = {}) => User.create({
    name: overrides.name || 'Security Test User',
    email: overrides.email || randomEmail('user'),
    phone: overrides.phone || randomPhone(),
    authUid: overrides.authUid || randomSuffix('uid'),
    isVerified: true,
    isAdmin: false,
    adminRoles: [],
    isSeller: false,
    accountState: 'active',
    ...overrides,
});

const createAdminUser = (overrides = {}) => createTestUser({
    name: 'Security Test Admin',
    isAdmin: true,
    adminRoles: ['ADMIN'],
    authAssurance: 'password+otp',
    authAssuranceAuthTime: Math.floor(Date.now() / 1000),
    loginOtpAssuranceExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ...overrides,
});

const createSuperAdminUser = (overrides = {}) => createAdminUser({
    adminRoles: ['ADMIN', 'SUPER_ADMIN'],
    ...overrides,
});

const createBlockedUser = (overrides = {}) => createTestUser({
    accountState: 'suspended',
    moderation: {
        suspendedAt: new Date(),
        suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
        suspensionReason: 'security test blocked user',
    },
    ...overrides,
});

const createDeletedUser = (overrides = {}) => createTestUser({
    accountState: 'deleted',
    softDeleted: true,
    ...overrides,
});

const createSellerUser = (overrides = {}) => createTestUser({
    isSeller: true,
    sellerActivatedAt: new Date(),
    ...overrides,
});

const createFakeProduct = (overrides = {}) => {
    const suffix = randomSuffix('product');
    const numericId = overrides.id || crypto.randomInt(100000, 1000000);
    return Product.create({
        id: numericId,
        externalId: `ext-${numericId}-${suffix}`,
        title: overrides.title || `Security Product ${suffix}`,
        displayTitle: overrides.displayTitle || `Security Product ${suffix}`,
        brand: overrides.brand || 'AuraSec',
        category: overrides.category || 'Security',
        subCategory: overrides.subCategory || 'Test',
        price: overrides.price ?? 1999,
        originalPrice: overrides.originalPrice ?? (overrides.price ?? 1999),
        discountPercentage: overrides.discountPercentage ?? 0,
        rating: overrides.rating ?? 4.2,
        ratingCount: overrides.ratingCount ?? 7,
        image: overrides.image || `https://example.test/assets/${suffix}.jpg`,
        stock: overrides.stock ?? 5,
        isActive: overrides.isActive ?? true,
        isPublished: overrides.isPublished ?? true,
        contentQuality: {
            publishReady: true,
            completenessScore: 100,
            hasDescription: true,
            hasBrand: true,
            hasImage: true,
            ...(overrides.contentQuality || {}),
        },
        publishGate: {
            status: 'approved',
            ...(overrides.publishGate || {}),
        },
        ...overrides,
    });
};

const createFakeOrder = async ({
    userId,
    product = null,
    totalPrice = 1999,
    paymentIntentId = '',
    paymentState = PAYMENT_STATUSES.CREATED,
    orderStatus = 'placed',
    isPaid = false,
    isDelivered = false,
    paymentMethod = 'CARD',
    overrides = {},
} = {}) => {
    const orderProduct = product || await createFakeProduct({ price: totalPrice, stock: 10 });
    return Order.create({
        user: userId,
        orderItems: [{
            title: orderProduct.title,
            quantity: 1,
            image: orderProduct.image,
            price: totalPrice,
            product: orderProduct._id,
        }],
        shippingAddress: {
            address: '221B Security Street',
            city: 'Bengaluru',
            postalCode: '560001',
            country: 'India',
        },
        paymentMethod,
        itemsPrice: totalPrice,
        taxPrice: 0,
        shippingPrice: 0,
        totalPrice,
        settlementAmount: totalPrice,
        settlementCurrency: 'INR',
        presentmentTotalPrice: totalPrice,
        presentmentCurrency: 'INR',
        paymentIntentId,
        paymentProvider: paymentIntentId ? 'razorpay' : '',
        paymentState,
        orderStatus,
        isPaid,
        paidAt: isPaid ? new Date() : undefined,
        isDelivered,
        deliveredAt: isDelivered ? new Date() : undefined,
        statusTimeline: [{
            status: orderStatus,
            message: 'Security test order seeded',
            actor: 'system',
            at: new Date(),
        }],
        refundSummary: {
            totalRefunded: 0,
            settlementCurrency: 'INR',
            presentmentCurrency: 'INR',
            presentmentTotalRefunded: 0,
            fullyRefunded: false,
            refunds: [],
        },
        ...overrides,
    });
};

const createFakePaymentIntent = ({
    userId,
    order = null,
    intentId = `pi_${randomSuffix('intent')}`,
    providerOrderId = `order_${randomSuffix('provider')}`,
    providerPaymentId = '',
    amount = 1999,
    currency = 'INR',
    method = 'CARD',
    status = PAYMENT_STATUSES.CREATED,
    expiresAt = new Date(Date.now() + 30 * 60 * 1000),
    overrides = {},
} = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    order,
    provider: 'razorpay',
    providerOrderId,
    providerPaymentId,
    amount,
    currency,
    settlementAmount: amount,
    settlementCurrency: currency,
    method,
    status,
    expiresAt,
    riskSnapshot: {
        score: 0,
        decision: 'allow',
        factors: [],
        mode: 'shadow',
    },
    challenge: {
        required: false,
        status: 'none',
        verifiedAt: null,
    },
    orderClaim: {
        state: order ? 'consumed' : 'none',
        key: '',
        lockedAt: null,
    },
    metadata: {},
    ...overrides,
});

const createFakePaymentMethod = ({
    userId,
    providerMethodId = `pm_${randomSuffix('method')}`,
    type = 'card',
    isDefault = false,
    overrides = {},
} = {}) => PaymentMethod.create({
    user: userId,
    provider: 'stripe',
    providerMethodId,
    type,
    brand: 'Visa',
    last4: '4242',
    isDefault,
    status: 'active',
    fingerprintHash: crypto.createHash('sha256').update(`${userId}:${providerMethodId}`).digest('hex'),
    metadata: { enrollmentSource: 'checkout' },
    ...overrides,
});

const createFakeWebhookEvent = ({
    eventId = `evt_${randomSuffix('webhook')}`,
    eventType = 'payment.captured',
    paymentId = `pay_${randomSuffix('payment')}`,
    providerOrderId,
    amount = 1999,
    currency = 'INR',
    status = 'captured',
    extraPayment = {},
} = {}) => ({
    id: eventId,
    event: eventType,
    payload: {
        payment: {
            entity: {
                id: paymentId,
                order_id: providerOrderId,
                amount: Math.round(Number(amount) * 100),
                currency,
                status,
                ...extraPayment,
            },
        },
    },
});

const createPaymentEvent = (overrides = {}) => PaymentEvent.create({
    eventId: overrides.eventId || `evt_${randomSuffix('saved')}`,
    intentId: overrides.intentId || `pi_${randomSuffix('event-intent')}`,
    source: overrides.source || 'webhook',
    type: overrides.type || 'payment.captured',
    payloadHash: overrides.payloadHash || crypto.createHash('sha256').update(JSON.stringify(overrides.payload || {})).digest('hex'),
    payload: overrides.payload || {},
    receivedAt: overrides.receivedAt || new Date(),
});

const buildBearer = (token) => `Bearer ${token}`;

const expiredToken = () => 'expired-token';
const tamperedToken = () => 'tampered-token';
const stolenRefreshToken = () => 'stolen-refresh-token';

const rateLimitStress = async ({ times, requestFactory }) => {
    const responses = [];
    for (let index = 0; index < times; index += 1) {
        responses.push(await requestFactory(index));
    }
    return responses;
};

module.exports = {
    SAFE_STATUS_CODES,
    assertSafeStatus,
    expectDocumentUnchanged,
    randomSuffix,
    randomEmail,
    randomPhone,
    objectId,
    buildBearer,
    expiredToken,
    tamperedToken,
    stolenRefreshToken,
    rateLimitStress,
    createTestUser,
    createAdminUser,
    createSuperAdminUser,
    createBlockedUser,
    createDeletedUser,
    createSellerUser,
    createFakeProduct,
    createFakeOrder,
    createFakePaymentIntent,
    createFakePaymentMethod,
    createFakeWebhookEvent,
    createPaymentEvent,
};
