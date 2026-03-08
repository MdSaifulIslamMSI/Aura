const { signInWithEmailPassword } = require('./lib/firebaseEmailAuth');
const budgets = require('../../docs/performance-budgets.json');

const parseArgs = () => process.argv.slice(2).reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;
    const [rawKey, ...rawValue] = arg.slice(2).split('=');
    acc[rawKey] = rawValue.length > 0 ? rawValue.join('=') : 'true';
    return acc;
}, {});

const args = parseArgs();

const baseUrl = String(args['base-url'] || process.env.LOAD_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const mode = String(args.mode || process.env.LOAD_MODE || 'public').trim().toLowerCase();
const iterations = Math.max(1, Number(args.iterations || process.env.LOAD_ITERATIONS || 20));
const concurrency = Math.max(1, Number(args.concurrency || process.env.LOAD_CONCURRENCY || 4));
const searchTerm = String(args['search-term'] || process.env.LOAD_SEARCH_TERM || 'phone').trim();
const userToken = String(args['user-token'] || process.env.LOAD_USER_BEARER_TOKEN || process.env.SMOKE_USER_BEARER_TOKEN || '').trim();
const adminToken = String(args['admin-token'] || process.env.LOAD_ADMIN_BEARER_TOKEN || process.env.SMOKE_ADMIN_BEARER_TOKEN || '').trim();
const firebaseApiKey = String(
    args['firebase-api-key']
    || process.env.LOAD_FIREBASE_API_KEY
    || process.env.SMOKE_FIREBASE_API_KEY
    || process.env.FIREBASE_WEB_API_KEY
    || ''
).trim();
const userEmail = String(args['user-email'] || process.env.LOAD_USER_EMAIL || process.env.SMOKE_USER_EMAIL || '').trim();
const userPassword = String(args['user-password'] || process.env.LOAD_USER_PASSWORD || process.env.SMOKE_USER_PASSWORD || '').trim();
const adminEmail = String(args['admin-email'] || process.env.LOAD_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || '').trim();
const adminPassword = String(args['admin-password'] || process.env.LOAD_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || '').trim();
const productIdOverride = String(args['product-id'] || process.env.LOAD_PRODUCT_ID || process.env.SMOKE_PRODUCT_ID || '').trim();

const allowedModes = new Set(['public', 'customer', 'full']);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const resolveAuthToken = async ({ label, token, email, password }) => {
    if (token) return token;
    assert(firebaseApiKey, 'LOAD_FIREBASE_API_KEY is required when bearer token overrides are not provided');
    assert(email, `${label} email is required when bearer token overrides are not provided`);
    assert(password, `${label} password is required when bearer token overrides are not provided`);
    const signIn = await signInWithEmailPassword({
        apiKey: firebaseApiKey,
        email,
        password,
    });
    return signIn.idToken;
};

const percentile = (values, target) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1);
    return sorted[index];
};

const average = (values) => values.length === 0
    ? 0
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));

const fetchJson = async (pathname, {
    method = 'GET',
    token = '',
    body,
    query,
} = {}) => {
    const url = new URL(pathname, `${baseUrl}/`);
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    const startedAt = Date.now();
    const response = await fetch(url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const durationMs = Date.now() - startedAt;
    const text = await response.text();

    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch (error) {
            throw new Error(`Non-JSON response from ${url}: ${error.message}`);
        }
    }

    return {
        status: response.status,
        durationMs,
        json,
    };
};

const getProductId = (product = {}) => String(product._id || product.id || '').trim();

const runPool = async (tasks, maxConcurrency) => {
    const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, async () => {
        while (tasks.length > 0) {
            const task = tasks.shift();
            if (!task) return;
            await task();
        }
    });
    await Promise.all(workers);
};

const buildSmokeProductPayload = () => ({
    title: `Load Runtime Product ${new Date().toISOString().slice(0, 19)}`,
    price: 1999,
    originalPrice: 2499,
    description: 'Operational load-validation product for split-runtime backend checks.',
    category: 'Electronics',
    brand: 'Aura',
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80',
    stock: 50,
    discountPercentage: 20,
    deliveryTime: '2 days',
    warranty: '1 year warranty',
    highlights: ['Load validation', 'Split runtime', 'Deterministic product'],
    specifications: [
        { key: 'Purpose', value: 'Load validation' },
        { key: 'Trust', value: 'Bootstrapped by admin' },
    ],
});

const discoverProduct = async ({ adminAuthToken = '' } = {}) => {
    if (productIdOverride) {
        return {
            productId: productIdOverride,
            searchLabel: '(product id override)',
        };
    }

    const candidates = [searchTerm, ''];
    for (const candidate of candidates) {
        const response = await fetchJson('/api/products', {
            query: {
                ...(candidate ? { keyword: candidate } : {}),
                limit: 6,
                sort: 'relevance',
            },
        });
        if (response.status !== 200) {
            continue;
        }
        const product = Array.isArray(response.json?.products) ? response.json.products[0] : null;
        const productId = getProductId(product);
        if (productId) {
            return {
                productId,
                searchLabel: candidate || '(catalog fallback)',
            };
        }
    }

    if (mode === 'full' && adminAuthToken) {
        const created = await fetchJson('/api/products', {
            method: 'POST',
            token: adminAuthToken,
            body: buildSmokeProductPayload(),
        });
        if (created.status === 201) {
            return {
                productId: getProductId(created.json),
                searchLabel: '(admin bootstrap)',
            };
        }
    }

    throw new Error(`No product id available for search term "${searchTerm}" or fallback catalog query`);
};

const summarizeScenario = (measurements) => {
    const durations = measurements.filter((entry) => entry.ok).map((entry) => entry.durationMs);
    const total = measurements.length;
    const failures = measurements.filter((entry) => !entry.ok);
    return {
        count: total,
        failures: failures.length,
        errorRatePct: total === 0 ? 0 : Number(((failures.length / total) * 100).toFixed(2)),
        avgMs: average(durations),
        p95Ms: percentile(durations, 95),
        maxMs: durations.length ? Math.max(...durations) : 0,
        failureSamples: failures.slice(0, 3).map((entry) => entry.message),
    };
};

const run = async () => {
    assert(allowedModes.has(mode), `Unsupported LOAD_MODE: ${mode}`);
    let resolvedUserToken = userToken;
    let resolvedAdminToken = adminToken;
    if (mode !== 'public') {
        resolvedUserToken = await resolveAuthToken({
            label: 'customer',
            token: userToken,
            email: userEmail,
            password: userPassword,
        });
    }
    if (mode === 'full') {
        resolvedAdminToken = await resolveAuthToken({
            label: 'admin',
            token: adminToken,
            email: adminEmail,
            password: adminPassword,
        });
    }

    const discovery = await discoverProduct({ adminAuthToken: resolvedAdminToken });
    const productId = discovery.productId;
    console.log(`Bootstrap product discovery: ${productId} via ${discovery.searchLabel}`);

    const quoteBody = mode === 'public'
        ? null
        : {
            orderItems: [{ product: productId, qty: 1 }],
            shippingAddress: {
                address: process.env.LOAD_SHIPPING_ADDRESS || '221B Test Street',
                city: process.env.LOAD_SHIPPING_CITY || 'Bengaluru',
                pincode: process.env.LOAD_SHIPPING_PINCODE || '560001',
                state: process.env.LOAD_SHIPPING_STATE || 'Karnataka',
            },
            paymentMethod: process.env.LOAD_PAYMENT_METHOD || 'COD',
            deliveryOption: process.env.LOAD_DELIVERY_OPTION || 'standard',
            checkoutSource: 'directBuy',
        };

    const scenarios = [
        {
            name: 'health',
            budgetMs: budgets.browse.healthP95Ms,
            execute: () => fetchJson('/health'),
            validate: (response) => response.status === 200 && response.json?.status === 'ok',
        },
        {
            name: 'search',
            budgetMs: budgets.browse.searchP95Ms,
            execute: () => fetchJson('/api/products', {
                query: {
                    keyword: searchTerm,
                    limit: 12,
                    sort: 'relevance',
                },
            }),
            validate: (response) => response.status === 200 && Array.isArray(response.json?.products) && response.json.products.length > 0,
        },
        {
            name: 'productDetail',
            budgetMs: budgets.browse.productDetailP95Ms,
            execute: () => fetchJson(`/api/products/${encodeURIComponent(productId)}`),
            validate: (response) => response.status === 200 && getProductId(response.json) === productId,
        },
    ];

    if (mode !== 'public') {
        scenarios.push({
            name: 'authSession',
            budgetMs: budgets.browse.productDetailP95Ms,
            execute: () => fetchJson('/api/auth/session', { token: resolvedUserToken }),
            validate: (response) => response.status === 200 && response.json?.status === 'authenticated',
        });
        scenarios.push({
            name: 'quote',
            budgetMs: budgets.checkout.quoteP95Ms,
            execute: () => fetchJson('/api/orders/quote', {
                method: 'POST',
                token: resolvedUserToken,
                body: quoteBody,
            }),
            validate: (response) => response.status === 200 && Number(response.json?.totalPrice || 0) > 0,
        });
    }

    if (mode === 'full') {
        scenarios.push({
            name: 'adminReadiness',
            budgetMs: budgets.browse.productDetailP95Ms,
            execute: () => fetchJson('/api/admin/ops/readiness', { token: resolvedAdminToken }),
            validate: (response) => response.status === 200 && response.json?.success === true,
        });
    }

    const measurements = Object.fromEntries(scenarios.map((scenario) => [scenario.name, []]));
    const tasks = [];

    scenarios.forEach((scenario) => {
        for (let index = 0; index < iterations; index += 1) {
            tasks.push(async () => {
                try {
                    const response = await scenario.execute();
                    const ok = scenario.validate(response);
                    measurements[scenario.name].push({
                        ok,
                        durationMs: response.durationMs,
                        message: ok
                            ? ''
                            : `${scenario.name} returned ${response.status}`,
                    });
                } catch (error) {
                    measurements[scenario.name].push({
                        ok: false,
                        durationMs: 0,
                        message: error.message,
                    });
                }
            });
        }
    });

    await runPool(tasks, concurrency);

    const summaries = scenarios.map((scenario) => {
        const summary = summarizeScenario(measurements[scenario.name]);
        const failures = [];
        if (summary.errorRatePct > budgets.browse.maxErrorRatePct) {
            failures.push(`error rate ${summary.errorRatePct}% > ${budgets.browse.maxErrorRatePct}%`);
        }
        if (summary.p95Ms > scenario.budgetMs) {
            failures.push(`p95 ${summary.p95Ms}ms > ${scenario.budgetMs}ms`);
        }
        return {
            name: scenario.name,
            budgetMs: scenario.budgetMs,
            ...summary,
            failures,
        };
    });

    let readinessSummary = null;
    if (mode === 'full') {
        const readiness = await fetchJson('/api/admin/ops/readiness', { token: resolvedAdminToken });
        assert(readiness.status === 200 && readiness.json?.success === true, 'Final readiness snapshot failed');
        const backlogs = readiness.json.readiness?.backlogs || {};
        readinessSummary = {
            paymentCapture: Number(backlogs.paymentCapture || 0),
            refunds: Number(backlogs.refunds || 0),
            orderEmail: Number(backlogs.orderEmail || 0),
            replacements: Number(backlogs.replacements || 0),
            staleLocks: Number(backlogs.staleLocks || 0),
            unsafeMismatchCount: Number(readiness.json.readiness?.modules?.commerceReconciliation?.signals?.unsafeMismatchCount || 0),
        };
    }

    const output = {
        baseUrl,
        mode,
        iterations,
        concurrency,
        budgetsVersion: budgets.version,
        scenarios: summaries,
        readinessSummary,
    };

    console.log(JSON.stringify(output, null, 2));

    const violations = [];
    summaries.forEach((summary) => {
        summary.failures.forEach((failure) => {
            violations.push(`${summary.name}: ${failure}`);
        });
    });

    if (readinessSummary) {
        if (readinessSummary.paymentCapture > budgets.operations.maxPaymentCaptureBacklog) {
            violations.push(`payment capture backlog ${readinessSummary.paymentCapture} > ${budgets.operations.maxPaymentCaptureBacklog}`);
        }
        if (readinessSummary.refunds > budgets.operations.maxRefundBacklog) {
            violations.push(`refund backlog ${readinessSummary.refunds} > ${budgets.operations.maxRefundBacklog}`);
        }
        if (readinessSummary.orderEmail > budgets.operations.maxOrderEmailBacklog) {
            violations.push(`order email backlog ${readinessSummary.orderEmail} > ${budgets.operations.maxOrderEmailBacklog}`);
        }
        if (readinessSummary.replacements > budgets.operations.maxReplacementBacklog) {
            violations.push(`replacement backlog ${readinessSummary.replacements} > ${budgets.operations.maxReplacementBacklog}`);
        }
        if (readinessSummary.staleLocks > budgets.operations.maxStaleLocks) {
            violations.push(`stale locks ${readinessSummary.staleLocks} > ${budgets.operations.maxStaleLocks}`);
        }
        if (readinessSummary.unsafeMismatchCount > budgets.operations.maxUnsafeReconciliationMismatches) {
            violations.push(`unsafe mismatches ${readinessSummary.unsafeMismatchCount} > ${budgets.operations.maxUnsafeReconciliationMismatches}`);
        }
    }

    if (violations.length > 0) {
        console.error(`Load validation failed:\n- ${violations.join('\n- ')}`);
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error(`Load validation failed: ${error.message}`);
    process.exitCode = 1;
});
