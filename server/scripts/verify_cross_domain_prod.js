const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const readEnvFile = (filePath) => {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return dotenv.parse(raw);
    } catch {
        return {};
    }
};

const appEnv = readEnvFile(path.join(__dirname, '..', '..', 'app', '.env.production'));

const buildProbePhone = () => {
    const tail = String(Date.now()).slice(-9).padStart(9, '0');
    return `+919${tail}`;
};

const PRIMARY_URL = String(
    process.env.CROSS_DOMAIN_PRIMARY_URL
    || appEnv.VITE_NETLIFY_FRONTEND_URL
    || 'https://aurapilot.netlify.app'
).trim().replace(/\/+$/, '');

const SECONDARY_URL = String(
    process.env.CROSS_DOMAIN_SECONDARY_URL
    || appEnv.VITE_VERCEL_FRONTEND_URL
    || 'https://aurapilot.vercel.app'
).trim().replace(/\/+$/, '');

const FIREBASE_API_KEY = String(
    process.env.CROSS_DOMAIN_FIREBASE_API_KEY
    || process.env.FIREBASE_WEB_API_KEY
    || appEnv.VITE_FIREBASE_API_KEY
    || ''
).trim();

const TEST_PHONE = String(process.env.CROSS_DOMAIN_TEST_PHONE || buildProbePhone()).trim();

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const logStep = (status, label, detail = '') => {
    const suffix = detail ? ` - ${detail}` : '';
    console.log(`[${status}] ${label}${suffix}`);
};

const parseJsonSafely = async (response) => {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const fetchJson = async (baseUrl, pathname, {
    method = 'GET',
    token = '',
    headers = {},
    body,
} = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return {
        status: response.status,
        body: await parseJsonSafely(response),
    };
};

const decodeJwtPayload = (token = '') => {
    const [, payload = ''] = String(token || '').split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

const createFirebaseProbeUser = async () => {
    assert(FIREBASE_API_KEY, 'Missing Firebase web API key for cross-domain verification.');

    const email = `codex.cross-domain.${Date.now()}@example.com`;
    const password = 'CodexProbe!2026';
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
        }),
    });
    const body = await parseJsonSafely(response);
    assert(response.status === 200, `Firebase probe signup failed: ${JSON.stringify(body)}`);

    return {
        email,
        password,
        idToken: body.idToken,
        claims: decodeJwtPayload(body.idToken),
    };
};

const deleteFirebaseProbeUser = async (idToken = '') => {
    if (!idToken || !FIREBASE_API_KEY) return;

    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
    }).catch(() => {});
};

const bootstrapStrongConsumerUser = async ({ email = '', authTime = 0 } = {}) => {
    assert(process.env.MONGO_URI, 'MONGO_URI is required to prepare the verification user.');

    const user = await User.findOne({ email });
    assert(user?._id, `Verification user ${email} was not bootstrapped into Mongo.`);

    user.phone = TEST_PHONE;
    user.isVerified = true;
    user.isSeller = false;
    user.isAdmin = false;
    user.authAssurance = 'password+otp';
    user.authAssuranceAt = new Date();
    user.authAssuranceAuthTime = Number(authTime || 0);
    user.loginOtpAssuranceExpiresAt = new Date(Date.now() + (10 * 60 * 1000));
    await user.save();

    return user;
};

const pickProduct = async (baseUrl) => {
    const productsResponse = await fetchJson(baseUrl, '/api/products');
    assert(productsResponse.status === 200, `Product catalog fetch failed on ${baseUrl}`);

    const products = Array.isArray(productsResponse.body?.products)
        ? productsResponse.body.products
        : [];
    const product = products.find((entry) => Number.isInteger(Number(entry?.id)) && Number(entry?.stock || 0) > 0)
        || products[0];

    assert(product?.id, `No product available for verification on ${baseUrl}`);
    return product;
};

const resolveWishlistItemId = (item = {}) => Number(
    item?.id
    ?? item?._doc?.id
    ?? item?.productId
    ?? item?._doc?.productId
);

const verifySessions = async (idToken) => {
    const [primarySession, secondarySession] = await Promise.all([
        fetchJson(PRIMARY_URL, '/api/auth/session', { token: idToken }),
        fetchJson(SECONDARY_URL, '/api/auth/session', { token: idToken }),
    ]);

    assert(primarySession.status === 200, `Primary session bootstrap failed: ${JSON.stringify(primarySession.body)}`);
    assert(secondarySession.status === 200, `Secondary session bootstrap failed: ${JSON.stringify(secondarySession.body)}`);
    assert(
        String(primarySession.body?.profile?._id || '') === String(secondarySession.body?.profile?._id || ''),
        'Primary and secondary domains resolved different user profiles.'
    );

    logStep('ok', 'session.shared-profile', String(primarySession.body?.profile?._id || 'unknown'));
};

const verifyCartSync = async ({ idToken, productId }) => {
    const mutationId = `cross-cart-${Date.now()}`;
    const addCart = await fetchJson(PRIMARY_URL, '/api/cart/commands', {
        method: 'POST',
        token: idToken,
        body: {
            clientMutationId: mutationId,
            commands: [{ type: 'add_item', productId: Number(productId), quantity: 1 }],
        },
    });
    assert(addCart.status === 200, `Primary cart mutation failed: ${JSON.stringify(addCart.body)}`);

    const mirroredCart = await fetchJson(SECONDARY_URL, '/api/cart', { token: idToken });
    assert(mirroredCart.status === 200, `Secondary cart read failed: ${JSON.stringify(mirroredCart.body)}`);

    const cartItems = Array.isArray(mirroredCart.body?.items) ? mirroredCart.body.items : [];
    assert(
        cartItems.some((item) => Number(item?.productId) === Number(productId)),
        'Cart mutation on primary did not reflect on the secondary domain.'
    );

    logStep('ok', 'cart.reflected', `product ${productId}`);
};

const verifyProfileSync = async ({ idToken }) => {
    const bio = `cross-domain-bio-${Date.now()}`;
    const updateProfile = await fetchJson(PRIMARY_URL, '/api/users/profile', {
        method: 'PUT',
        token: idToken,
        body: { bio },
    });
    assert(updateProfile.status === 200, `Primary profile update failed: ${JSON.stringify(updateProfile.body)}`);

    const mirroredProfile = await fetchJson(SECONDARY_URL, '/api/users/profile', { token: idToken });
    assert(mirroredProfile.status === 200, `Secondary profile read failed: ${JSON.stringify(mirroredProfile.body)}`);
    assert(
        String(mirroredProfile.body?.bio || '') === bio,
        'Profile mutation on primary did not reflect on the secondary domain.'
    );

    logStep('ok', 'profile.reflected', bio);
};

const verifyWishlistSync = async ({ idToken, productId }) => {
    const addWishlist = await fetchJson(PRIMARY_URL, '/api/users/wishlist/items', {
        method: 'POST',
        token: idToken,
        body: { productId: Number(productId) },
    });
    assert([200, 201].includes(addWishlist.status), `Primary wishlist mutation failed: ${JSON.stringify(addWishlist.body)}`);

    const mirroredWishlist = await fetchJson(SECONDARY_URL, '/api/users/wishlist', { token: idToken });
    assert(mirroredWishlist.status === 200, `Secondary wishlist read failed: ${JSON.stringify(mirroredWishlist.body)}`);

    const items = Array.isArray(mirroredWishlist.body?.items) ? mirroredWishlist.body.items : [];
    assert(
        items.some((item) => resolveWishlistItemId(item) === Number(productId)),
        'Wishlist mutation on primary did not reflect on the secondary domain.'
    );

    logStep('ok', 'wishlist.reflected', `product ${productId}`);
};

const verifyOrderSync = async ({ idToken, productId }) => {
    const quotePayload = {
        orderItems: [{ product: Number(productId), qty: 1 }],
        shippingAddress: {
            address: '221B Test Street',
            city: 'Bengaluru',
            pincode: '560001',
            state: 'Karnataka',
        },
        paymentMethod: 'COD',
        deliveryOption: 'standard',
        checkoutSource: 'directBuy',
    };

    const quote = await fetchJson(PRIMARY_URL, '/api/orders/quote', {
        method: 'POST',
        token: idToken,
        body: quotePayload,
    });
    if (quote.status !== 200) {
        const quoteMessage = String(quote.body?.message || '').trim();
        if (
            quote.status === 403
            && /trusted device|cryptographically verified trusted device/i.test(quoteMessage)
        ) {
            throw new Error(
                'Order flow is still blocked on the live backend by trusted-device enforcement. '
                + 'The repo-side policy fix is ready, but the shared backend origin has not been redeployed yet.'
            );
        }
        throw new Error(`Primary order quote failed: ${JSON.stringify(quote.body)}`);
    }

    const orderCreate = await fetchJson(PRIMARY_URL, '/api/orders', {
        method: 'POST',
        token: idToken,
        headers: {
            'Idempotency-Key': `cross-order-${Date.now()}`,
        },
        body: {
            ...quotePayload,
            quoteSnapshot: {
                totalPrice: quote.body?.totalPrice,
                pricingVersion: quote.body?.pricingVersion,
            },
        },
    });
    assert(orderCreate.status === 201, `Primary order create failed: ${JSON.stringify(orderCreate.body)}`);

    const orderId = String(orderCreate.body?._id || '');
    assert(orderId, 'Primary order create did not return an order id.');

    const mirroredOrders = await fetchJson(SECONDARY_URL, '/api/orders/myorders', { token: idToken });
    assert(mirroredOrders.status === 200, `Secondary order list failed: ${JSON.stringify(mirroredOrders.body)}`);

    const orders = Array.isArray(mirroredOrders.body) ? mirroredOrders.body : [];
    assert(
        orders.some((order) => String(order?._id || '') === orderId),
        'Order created on primary did not reflect on the secondary domain.'
    );

    const timeline = await fetchJson(SECONDARY_URL, `/api/orders/${orderId}/timeline`, { token: idToken });
    assert(timeline.status === 200, `Secondary order timeline failed: ${JSON.stringify(timeline.body)}`);

    logStep('ok', 'orders.reflected', orderId);
    return orderId;
};

const cleanupProbeData = async ({ email = '', idToken = '' } = {}) => {
    try {
        if (mongoose.connection.readyState === 0 && process.env.MONGO_URI) {
            await mongoose.connect(process.env.MONGO_URI);
        }

        const user = email ? await User.findOne({ email }) : null;
        if (user?._id) {
            await Order.deleteMany({ user: user._id });
            await Cart.deleteMany({ user: user._id });
            await User.deleteOne({ _id: user._id });
        }
    } catch (error) {
        logStep('warn', 'cleanup.mongo', error.message || 'cleanup failed');
    }

    await deleteFirebaseProbeUser(idToken);

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
};

const main = async () => {
    let probe = null;

    try {
        probe = await createFirebaseProbeUser();
        logStep('ok', 'firebase.probe-user', probe.email);

        await verifySessions(probe.idToken);

        await mongoose.connect(process.env.MONGO_URI);
        await bootstrapStrongConsumerUser({
            email: probe.email,
            authTime: probe.claims.auth_time,
        });

        const product = await pickProduct(PRIMARY_URL);
        logStep('ok', 'catalog.pick', `${product.id} ${String(product.title || '').slice(0, 60)}`);

        await verifyCartSync({
            idToken: probe.idToken,
            productId: product.id,
        });
        await verifyProfileSync({ idToken: probe.idToken });
        await verifyWishlistSync({
            idToken: probe.idToken,
            productId: product.id,
        });
        await verifyOrderSync({
            idToken: probe.idToken,
            productId: product.id,
        });

        logStep('ok', 'cross-domain.verify', `${PRIMARY_URL} <-> ${SECONDARY_URL}`);
    } finally {
        await cleanupProbeData({
            email: probe?.email || '',
            idToken: probe?.idToken || '',
        });
    }
};

if (require.main === module) {
    main().catch((error) => {
        logStep('fail', 'cross-domain.verify', error.message || 'unknown failure');
        process.exitCode = 1;
    });
}

module.exports = {
    main,
};
