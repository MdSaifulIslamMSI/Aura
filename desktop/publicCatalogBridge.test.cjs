const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createPublicCatalogFetch,
    normalizePublicCatalogPath,
} = require('./publicCatalogBridge.cjs');

test('desktop public catalog bridge only allows product list and product detail reads', () => {
    assert.equal(normalizePublicCatalogPath('/products'), '/api/products');
    assert.equal(normalizePublicCatalogPath('/api/products'), '/api/products');
    assert.equal(normalizePublicCatalogPath('/products/400046981'), '/api/products/400046981');
    assert.equal(normalizePublicCatalogPath('/api/products/69adb7f43604b5b72b1e7533'), '/api/products/69adb7f43604b5b72b1e7533');

    assert.throws(() => normalizePublicCatalogPath('/admin/products'), /only supports product list/);
    assert.throws(() => normalizePublicCatalogPath('/products/recommendations'), /only supports product list/);
    assert.throws(() => normalizePublicCatalogPath('/products/400046981/reviews'), /only supports product list/);
});

test('desktop public catalog bridge fetches against the configured backend without credentials', async () => {
    const calls = [];
    const fetchPublicCatalog = createPublicCatalogFetch({
        backendOrigin: 'https://backend.example.test',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ products: [{ id: 1 }], total: 1 }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-catalog',
                },
            });
        },
    });

    const result = await fetchPublicCatalog({
        path: '/products',
        params: {
            limit: 12,
            sort: 'relevance',
            empty: '',
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.requestId, 'srv-catalog');
    assert.deepEqual(result.data, { products: [{ id: 1 }], total: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://backend.example.test/api/products?limit=12&sort=relevance');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, undefined);
    assert.equal(calls[0].init.headers['X-Aura-Desktop-Catalog-Bridge'], '1');
});

test('desktop public catalog bridge requires an HTTPS backend origin', async () => {
    const fetchPublicCatalog = createPublicCatalogFetch({
        backendOrigin: 'http://backend.example.test',
        fetchImpl: async () => new Response('{}', { status: 200 }),
    });

    await assert.rejects(
        () => fetchPublicCatalog({ path: '/products' }),
        /requires an HTTPS backend origin/
    );
});
