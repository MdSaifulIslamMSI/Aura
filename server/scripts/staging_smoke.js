const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { issuePaymentChallengeToken } = require('../utils/paymentChallengeToken');
const { signInWithEmailPassword } = require('./lib/firebaseEmailAuth');

const budgets = require('../../docs/performance-budgets.json');

const parseArgs = () => process.argv.slice(2).reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;
    const [rawKey, ...rawValue] = arg.slice(2).split('=');
    acc[rawKey] = rawValue.length > 0 ? rawValue.join('=') : 'true';
    return acc;
}, {});

const args = parseArgs();

const baseUrl = String(args['base-url'] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const flowMode = String(args.mode || process.env.SMOKE_FLOW_MODE || 'public').trim().toLowerCase();
const searchTerm = String(args['search-term'] || process.env.SMOKE_SEARCH_TERM || 'phone').trim();
const userToken = String(args['user-token'] || process.env.SMOKE_USER_BEARER_TOKEN || '').trim();
const adminToken = String(args['admin-token'] || process.env.SMOKE_ADMIN_BEARER_TOKEN || '').trim();
const firebaseApiKey = String(
    args['firebase-api-key']
    || process.env.SMOKE_FIREBASE_API_KEY
    || process.env.FIREBASE_WEB_API_KEY
    || ''
).trim();
const userEmail = String(args['user-email'] || process.env.SMOKE_USER_EMAIL || '').trim();
const userPassword = String(args['user-password'] || process.env.SMOKE_USER_PASSWORD || '').trim();
const userName = String(args['user-name'] || process.env.SMOKE_USER_NAME || 'Smoke User').trim();
const userPhone = String(args['user-phone'] || process.env.SMOKE_USER_PHONE || '+919999999999').trim();
const adminEmail = String(args['admin-email'] || process.env.SMOKE_ADMIN_EMAIL || '').trim();
const adminPassword = String(args['admin-password'] || process.env.SMOKE_ADMIN_PASSWORD || '').trim();
const orderPayloadFile = String(args['order-payload-file'] || process.env.SMOKE_ORDER_PAYLOAD_FILE || '').trim();
const productIdOverride = String(args['product-id'] || process.env.SMOKE_PRODUCT_ID || '').trim();
const digitalPaymentMethod = String(
    args['digital-payment-method']
    || process.env.SMOKE_DIGITAL_PAYMENT_METHOD
    || 'UPI'
).trim().toUpperCase();
const razorpayPaymentId = String(args['razorpay-payment-id'] || process.env.SMOKE_RAZORPAY_PAYMENT_ID || '').trim();
const skipDigitalCheckout = String(args['skip-digital'] || process.env.SMOKE_SKIP_DIGITAL_CHECKOUT || 'false').trim().toLowerCase() === 'true';

const allowedModes = new Set(['public', 'customer', 'full']);

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const requireEnv = (value, name) => {
    assert(value, `${name} is required for ${flowMode} smoke mode`);
    return value;
};

const makeIdempotencyKey = (prefix = 'smoke') => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const buildHeaders = (token = '', body = false, extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    return headers;
};

const resolveAuthToken = async ({
    label,
    token,
    email,
    password,
}) => {
    if (token) return token;
    if (!email || !password) {
        throw new Error(`${label} Firebase email/password credentials are required when no bearer token override is provided`);
    }

    const signIn = await signInWithEmailPassword({
        apiKey: firebaseApiKey,
        email,
        password,
    });
    return signIn.idToken;
};

const buildPaymentConfirmation = ({
    provider,
    providerOrderId,
    amount,
}) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    if (normalizedProvider === 'razorpay') {
        const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (!razorpayPaymentId) {
            throw new Error('SMOKE_RAZORPAY_PAYMENT_ID is required to complete the Razorpay staging confirmation path');
        }
        if (!keySecret) {
            throw new Error('RAZORPAY_KEY_SECRET is required to sign the Razorpay staging confirmation path');
        }
        return {
            providerPaymentId: razorpayPaymentId,
            providerOrderId,
            providerSignature: crypto.createHmac('sha256', keySecret).update(`${providerOrderId}|${razorpayPaymentId}`).digest('hex'),
            amount,
        };
    }

    throw new Error(`Unsupported payment provider for smoke confirmation: ${provider || 'unknown'}`);
};

const fetchJson = async (pathname, {
    method = 'GET',
    token = '',
    body,
    expectedStatus,
    query,
    headers = {},
} = {}) => {
    const url = new URL(pathname, `${baseUrl}/`);
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    const response = await fetch(url, {
        method,
        headers: buildHeaders(token, body !== undefined, headers),
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch (error) {
            throw new Error(`Non-JSON response from ${url}: ${error.message}`);
        }
    }

    if (expectedStatus !== undefined && response.status !== expectedStatus) {
        const detail = json?.message || json?.detail || response.statusText || 'unexpected response';
        throw new Error(`${method} ${url} returned ${response.status}, expected ${expectedStatus}: ${detail}`);
    }

    return {
        status: response.status,
        json,
        url: String(url),
    };
};

const buildSocketPollingUrl = ({ sid = '', nonce = '' } = {}) => {
    const url = new URL('/socket.io/', `${baseUrl}/`);
    url.searchParams.set('EIO', '4');
    url.searchParams.set('transport', 'polling');
    url.searchParams.set('t', nonce || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    if (sid) {
        url.searchParams.set('sid', sid);
    }
    return url;
};

const fetchText = async (url, {
    method = 'GET',
    headers = {},
    body,
    expectedStatus,
} = {}) => {
    const response = await fetch(url, {
        method,
        headers,
        body,
    });

    const text = await response.text();
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
        throw new Error(`${method} ${url} returned ${response.status}, expected ${expectedStatus}: ${text || response.statusText || 'unexpected response'}`);
    }

    return {
        status: response.status,
        text,
        url: String(url),
    };
};

const extractSocketSid = (payload = '') => {
    const match = String(payload || '').match(/"sid":"([^"]+)"/);
    return match ? String(match[1] || '').trim() : '';
};

const verifySocketRoute = async ({ token = '' } = {}) => {
    const openResponse = await fetchText(buildSocketPollingUrl(), {
        expectedStatus: 200,
    });
    const sid = extractSocketSid(openResponse.text);
    assert(sid, `Socket polling handshake did not return a sid: ${openResponse.text}`);
    printStep('ok', 'socket.open', sid);

    if (!token) {
        return {
            sid,
            authenticated: false,
        };
    }

    await fetchText(buildSocketPollingUrl({ sid }), {
        method: 'POST',
        expectedStatus: 200,
        headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: `40${JSON.stringify({ token })}`,
    });

    const connectResponse = await fetchText(buildSocketPollingUrl({ sid }), {
        expectedStatus: 200,
    });
    assert(
        String(connectResponse.text || '').startsWith('40'),
        `Socket authenticated handshake failed: ${connectResponse.text || 'empty response'}`
    );
    printStep('ok', 'socket.auth', extractSocketSid(connectResponse.text) || sid);

    return {
        sid,
        authenticated: true,
    };
};

const getProductId = (product = {}) => String(product._id || product.id || '').trim();

const buildDefaultOrderPayload = (productId, paymentMethod = process.env.SMOKE_PAYMENT_METHOD || 'COD') => ({
    orderItems: [{ product: productId, qty: 1 }],
    shippingAddress: {
        address: process.env.SMOKE_SHIPPING_ADDRESS || '221B Test Street',
        city: process.env.SMOKE_SHIPPING_CITY || 'Bengaluru',
        pincode: process.env.SMOKE_SHIPPING_PINCODE || '560001',
        state: process.env.SMOKE_SHIPPING_STATE || 'Karnataka',
    },
    paymentMethod,
    deliveryOption: process.env.SMOKE_DELIVERY_OPTION || 'standard',
    checkoutSource: process.env.SMOKE_CHECKOUT_SOURCE || 'directBuy',
});

const loadOrderPayload = (productId, paymentMethod = process.env.SMOKE_PAYMENT_METHOD || 'COD') => {
    if (!orderPayloadFile) {
        return buildDefaultOrderPayload(productId, paymentMethod);
    }

    const filePath = path.resolve(orderPayloadFile);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(payload.orderItems) || payload.orderItems.length === 0) {
        throw new Error(`Order payload file ${filePath} must include at least one orderItems entry`);
    }

    const firstItem = payload.orderItems[0];
    if (!firstItem.product && !firstItem.productId && !firstItem.id) {
        firstItem.product = productId;
    }
    payload.paymentMethod = payload.paymentMethod || paymentMethod;

    return payload;
};

const buildSmokeProductPayload = () => ({
    title: `Smoke Runtime Product ${new Date().toISOString().slice(0, 19)}`,
    price: 1999,
    originalPrice: 2499,
    description: 'Operational smoke product for split-runtime validation flows.',
    category: 'Electronics',
    brand: 'Aura',
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80',
    stock: 25,
    discountPercentage: 20,
    deliveryTime: '2 days',
    warranty: '1 year warranty',
    highlights: ['Smoke validation', 'Split runtime', 'Checkout path'],
    specifications: [
        { key: 'Purpose', value: 'Smoke validation' },
        { key: 'Trust', value: 'Bootstrapped by admin' },
    ],
});

const bootstrapSmokeProduct = async (adminAuthToken) => {
    assert(adminAuthToken, 'Admin token is required to bootstrap a smoke product');
    const created = await fetchJson('/api/products', {
        method: 'POST',
        token: adminAuthToken,
        expectedStatus: 201,
        body: buildSmokeProductPayload(),
    });
    const productId = getProductId(created.json);
    assert(productId, 'Admin smoke product bootstrap did not return a product id');
    return {
        searchLabel: '(admin bootstrap)',
        products: [created.json],
    };
};

const printStep = (status, name, detail = '') => {
    const suffix = detail ? ` - ${detail}` : '';
    console.log(`[${status}] ${name}${suffix}`);
};

const discoverProducts = async ({ adminAuthToken = '' } = {}) => {
    if (productIdOverride) {
        const response = await fetchJson(`/api/products/${encodeURIComponent(productIdOverride)}`, {
            expectedStatus: 200,
        });
        return {
            searchLabel: '(product id override)',
            products: [response.json],
        };
    }

    const candidates = [searchTerm, ''];
    for (const candidate of candidates) {
        const response = await fetchJson('/api/products', {
            expectedStatus: 200,
            query: {
                ...(candidate ? { keyword: candidate } : {}),
                limit: 6,
                sort: 'relevance',
            },
        });
        const products = Array.isArray(response.json?.products) ? response.json.products : [];
        if (products.length > 0) {
            return {
                searchLabel: candidate || '(catalog fallback)',
                products,
            };
        }
    }

    if (flowMode === 'full' && adminAuthToken) {
        return bootstrapSmokeProduct(adminAuthToken);
    }

    throw new Error(`No products returned for keyword "${searchTerm}" or fallback catalog query`);
};

const runDigitalCheckoutFlow = async ({
    userAuthToken,
    sessionPayload,
    productId,
}) => {
    const digitalOrderPayload = loadOrderPayload(productId, digitalPaymentMethod);
    const digitalQuote = await fetchJson('/api/orders/quote', {
        method: 'POST',
        token: userAuthToken,
        expectedStatus: 200,
        body: digitalOrderPayload,
    });
    assert(Number(digitalQuote.json?.totalPrice || 0) > 0, 'Digital order quote totalPrice must be positive');
    printStep('ok', 'digital.quote', `total ${digitalQuote.json.totalPrice}`);

    const paymentIntent = await fetchJson('/api/payments/intents', {
        method: 'POST',
        token: userAuthToken,
        expectedStatus: 200,
        headers: {
            'Idempotency-Key': makeIdempotencyKey('payint'),
        },
        body: {
            quotePayload: digitalOrderPayload,
            quoteSnapshot: {
                totalPrice: digitalQuote.json.totalPrice,
                pricingVersion: digitalQuote.json.pricingVersion || `budget-v${budgets.version}`,
            },
            paymentMethod: digitalOrderPayload.paymentMethod,
            deviceContext: {
                platform: 'staging-smoke',
                language: 'en-IN',
                screen: '390x844',
            },
        },
    });
    assert(paymentIntent.json?.intentId, 'Payment intent creation did not return intentId');
    printStep('ok', 'digital.intent.create', paymentIntent.json.intentId);

    if (paymentIntent.json?.challengeRequired) {
        const profile = sessionPayload?.profile || {};
        assert(profile?._id, 'Session profile id is required for challenge verification');
        assert(profile?.phone, 'Session profile phone is required for challenge verification');
        const challenge = issuePaymentChallengeToken({
            userId: profile._id,
            phone: profile.phone,
            intentId: paymentIntent.json.intentId,
        });

        await fetchJson(`/api/payments/intents/${encodeURIComponent(paymentIntent.json.intentId)}/challenge/complete`, {
            method: 'POST',
            token: userAuthToken,
            expectedStatus: 200,
            body: {
                challengeToken: challenge.challengeToken,
            },
        });
        printStep('ok', 'digital.challenge.complete', paymentIntent.json.intentId);
    }

    const confirmation = buildPaymentConfirmation({
        provider: paymentIntent.json.provider,
        providerOrderId: paymentIntent.json.providerOrderId,
        amount: paymentIntent.json.amount,
    });

    const confirmedIntent = await fetchJson(`/api/payments/intents/${encodeURIComponent(paymentIntent.json.intentId)}/confirm`, {
        method: 'POST',
        token: userAuthToken,
        expectedStatus: 200,
        headers: {
            'Idempotency-Key': makeIdempotencyKey('paycnf'),
        },
        body: confirmation,
    });
    assert(['authorized', 'captured'].includes(String(confirmedIntent.json?.status || '').toLowerCase()), 'Payment intent confirmation did not authorize or capture');
    printStep('ok', 'digital.intent.confirm', confirmedIntent.json.status || 'authorized');

    const intentDetail = await fetchJson(`/api/payments/intents/${encodeURIComponent(paymentIntent.json.intentId)}`, {
        token: userAuthToken,
        expectedStatus: 200,
    });
    assert(String(intentDetail.json?.intentId || '') === String(paymentIntent.json.intentId), 'Payment intent detail mismatch');
    printStep('ok', 'digital.intent.status', intentDetail.json?.status || 'unknown');

    const digitalOrder = await fetchJson('/api/orders', {
        method: 'POST',
        token: userAuthToken,
        expectedStatus: 201,
        headers: {
            'Idempotency-Key': makeIdempotencyKey('orddig'),
        },
        body: {
            ...digitalOrderPayload,
            paymentIntentId: paymentIntent.json.intentId,
            quoteSnapshot: {
                totalPrice: digitalQuote.json.totalPrice,
                pricingVersion: digitalQuote.json.pricingVersion || `budget-v${budgets.version}`,
            },
        },
    });
    const digitalOrderId = String(digitalOrder.json?._id || '').trim();
    assert(digitalOrderId, 'Digital order creation did not return an order id');
    printStep('ok', 'digital.order.create', digitalOrderId);

    const digitalTimeline = await fetchJson(`/api/orders/${digitalOrderId}/timeline`, {
        token: userAuthToken,
        expectedStatus: 200,
    });
    assert(String(digitalTimeline.json?.orderId || '') === digitalOrderId, 'Digital timeline response order id mismatch');
    printStep('ok', 'digital.order.timeline', digitalOrderId);

    return {
        orderId: digitalOrderId,
        quote: digitalQuote.json,
        order: digitalOrder.json,
        paymentIntent: paymentIntent.json,
        intentDetail: intentDetail.json,
    };
};

const run = async () => {
    assert(allowedModes.has(flowMode), `Unsupported SMOKE_FLOW_MODE: ${flowMode}`);

    let resolvedUserToken = userToken;
    let resolvedAdminToken = adminToken;

    if (flowMode !== 'public') {
        requireEnv(userEmail, 'SMOKE_USER_EMAIL');
        if (!userToken) {
            requireEnv(firebaseApiKey, 'SMOKE_FIREBASE_API_KEY');
            requireEnv(userPassword, 'SMOKE_USER_PASSWORD');
        }
        resolvedUserToken = await resolveAuthToken({
            label: 'customer',
            token: userToken,
            email: userEmail,
            password: userPassword,
        });
    }
    if (flowMode === 'full') {
        if (!adminToken) {
            requireEnv(firebaseApiKey, 'SMOKE_FIREBASE_API_KEY');
            requireEnv(adminEmail, 'SMOKE_ADMIN_EMAIL');
            requireEnv(adminPassword, 'SMOKE_ADMIN_PASSWORD');
        }
        resolvedAdminToken = await resolveAuthToken({
            label: 'admin',
            token: adminToken,
            email: adminEmail,
            password: adminPassword,
        });
    }

    const health = await fetchJson('/health', { expectedStatus: 200 });
    assert(health.json?.status === 'ok', 'Health endpoint is not healthy');
    printStep('ok', 'health', health.json?.status || 'ok');

    const ready = await fetchJson('/health/ready', { expectedStatus: 200 });
    assert(ready.json?.ready === true, 'Readiness endpoint is not ready');
    printStep('ok', 'ready', 'ready');

    await verifySocketRoute({
        token: flowMode === 'public' ? '' : resolvedUserToken,
    });

    const search = await discoverProducts({ adminAuthToken: resolvedAdminToken });
    const products = search.products;
    const product = products[0];
    const productId = getProductId(product);
    assert(productId, 'Search result did not expose a product identifier');
    printStep('ok', 'search', `${products.length} results via ${search.searchLabel}`);

    const pdp = await fetchJson(`/api/products/${encodeURIComponent(productId)}`, { expectedStatus: 200 });
    assert(getProductId(pdp.json) === productId, 'PDP response product id mismatch');
    printStep('ok', 'pdp', productId);

    if (flowMode === 'public') {
        console.log(`Smoke completed in public mode against ${baseUrl}`);
        return;
    }

    const synced = await fetchJson('/api/auth/sync', {
        method: 'POST',
        token: resolvedUserToken,
        expectedStatus: 200,
        headers: {
            'Idempotency-Key': makeIdempotencyKey('authsync'),
        },
        body: {
            email: userEmail,
            name: userName,
            phone: userPhone,
        },
    });
    assert(synced.json?.status === 'authenticated', 'Auth sync did not return authenticated status');
    printStep('ok', 'auth.sync', synced.json?.status || 'authenticated');

    const session = await fetchJson('/api/auth/session', {
        token: resolvedUserToken,
        expectedStatus: 200,
    });
    assert(session.json?.status === 'authenticated', 'Session endpoint did not return authenticated status');
    printStep('ok', 'auth.session', session.json?.profile?.email || userEmail);

    const orderPayload = loadOrderPayload(productId, 'COD');
    const quote = await fetchJson('/api/orders/quote', {
        method: 'POST',
        token: resolvedUserToken,
        expectedStatus: 200,
        body: orderPayload,
    });
    assert(Number(quote.json?.totalPrice || 0) > 0, 'Order quote totalPrice must be positive');
    printStep('ok', 'checkout.quote', `total ${quote.json.totalPrice}`);

    const order = await fetchJson('/api/orders', {
        method: 'POST',
        token: resolvedUserToken,
        expectedStatus: 201,
        headers: {
            'Idempotency-Key': makeIdempotencyKey('ordcod'),
        },
        body: {
            ...orderPayload,
            quoteSnapshot: {
                totalPrice: quote.json.totalPrice,
                pricingVersion: quote.json.pricingVersion || `budget-v${budgets.version}`,
            },
        },
    });
    const orderId = String(order.json?._id || '').trim();
    assert(orderId, 'Order creation did not return an order id');
    printStep('ok', 'checkout.create', orderId);

    const timeline = await fetchJson(`/api/orders/${orderId}/timeline`, {
        token: resolvedUserToken,
        expectedStatus: 200,
    });
    assert(String(timeline.json?.orderId || '') === orderId, 'Timeline response order id mismatch');
    printStep('ok', 'orders.timeline', orderId);

    let digitalCheckout = null;
    if (!skipDigitalCheckout) {
        digitalCheckout = await runDigitalCheckoutFlow({
            userAuthToken: resolvedUserToken,
            sessionPayload: session.json,
            productId,
        });
    }

    const refundTargetOrderId = digitalCheckout?.orderId || orderId;
    const refundTargetAmount = Number(digitalCheckout?.order?.totalPrice || order.json?.totalPrice || quote.json.totalPrice || 0);
    const refund = await fetchJson(`/api/orders/${refundTargetOrderId}/command-center/refund`, {
        method: 'POST',
        token: resolvedUserToken,
        expectedStatus: 201,
        body: {
            reason: 'Staging smoke refund request',
            amount: refundTargetAmount,
        },
    });
    const refundRequest = refund.json?.commandCenter?.refunds?.slice(-1)?.[0];
    assert(refundRequest?.requestId, 'Refund command center request id missing');
    printStep('ok', 'orders.refund.request', refundRequest.requestId);

    const replacement = await fetchJson(`/api/orders/${orderId}/command-center/replace`, {
        method: 'POST',
        token: resolvedUserToken,
        expectedStatus: 201,
        body: {
            reason: 'Staging smoke replacement request',
            itemProductId: productId,
            quantity: 1,
        },
    });
    const replacementRequest = replacement.json?.commandCenter?.replacements?.slice(-1)?.[0];
    assert(replacementRequest?.requestId, 'Replacement command center request id missing');
    printStep('ok', 'orders.replacement.request', `${replacementRequest.requestId}:${replacementRequest.status}`);

    if (flowMode !== 'full') {
        console.log(`Smoke completed in customer mode against ${baseUrl}`);
        return;
    }

    const adminReadiness = await fetchJson('/api/admin/ops/readiness', {
        token: resolvedAdminToken,
        expectedStatus: 200,
    });
    assert(Boolean(adminReadiness.json?.success), 'Admin readiness did not report success');
    printStep('ok', 'admin.readiness', String(adminReadiness.json?.readiness?.readinessScore || 'unknown'));

    const adminSmoke = await fetchJson('/api/admin/ops/smoke', {
        method: 'POST',
        token: resolvedAdminToken,
        expectedStatus: 200,
        body: {},
    });
    assert(adminSmoke.json?.smoke?.passed === true, 'Admin ops smoke did not pass');
    printStep('ok', 'admin.ops.smoke', 'passed');

    const processedRefund = await fetchJson(`/api/orders/${refundTargetOrderId}/command-center/refund/${refundRequest.requestId}/admin`, {
        method: 'PATCH',
        token: resolvedAdminToken,
        expectedStatus: 200,
        body: {
            status: 'processed',
            note: 'Staging smoke admin refund processing',
            amount: Number(refundRequest.amount || refundTargetAmount || 0),
            externalReference: `smoke-${refundRequest.requestId}`,
        },
    });
    const processedRefundStatus = processedRefund.json?.commandCenter?.refunds?.find(
        (entry) => entry.requestId === refundRequest.requestId
    )?.status;
    assert(processedRefundStatus === 'processed', 'Refund request was not processed by admin');
    printStep('ok', 'admin.refund.process', refundRequest.requestId);

    if (String(replacementRequest.status || '').toLowerCase() === 'shipped') {
        printStep('ok', 'admin.replacement.process', 'already auto-shipped');
    } else {
        const processedReplacement = await fetchJson(
            `/api/orders/${orderId}/command-center/replace/${replacementRequest.requestId}/admin`,
            {
                method: 'PATCH',
                token: resolvedAdminToken,
                expectedStatus: 200,
                body: {
                    status: 'shipped',
                    note: 'Staging smoke admin replacement dispatch',
                    trackingId: `smoke-${replacementRequest.requestId}`,
                },
            }
        );
        const processedReplacementStatus = processedReplacement.json?.commandCenter?.replacements?.find(
            (entry) => entry.requestId === replacementRequest.requestId
        )?.status;
        assert(processedReplacementStatus === 'shipped', 'Replacement request was not shipped by admin');
        printStep('ok', 'admin.replacement.process', replacementRequest.requestId);
    }

    console.log(`Smoke completed in full mode against ${baseUrl}`);
};

run().catch((error) => {
    console.error(`Smoke failed: ${error.message}`);
    process.exitCode = 1;
});
