const express = require('express');
const request = require('supertest');

const originalEnv = { ...process.env };

const buildApp = (router, mountPath) => {
    const app = express();
    app.use(express.json());
    app.use(mountPath, router);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

const resetProductionGateModules = () => {
    jest.resetModules();
    process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        AI_PUBLIC_ACCESS_ENABLED: 'false',
    };
};

const mockAiControllers = () => {
    const handlers = {
        createAiVoiceSession: jest.fn((_req, res) => res.status(201).json({ ok: true })),
        handleAiChat: jest.fn((_req, res) => res.json({ ok: true })),
        handleAiChatStream: jest.fn((_req, res) => res.end()),
        synthesizeAiVoiceReply: jest.fn((_req, res) => res.json({ ok: true })),
    };

    jest.doMock('../controllers/aiController', () => handlers);
    jest.doMock('../controllers/aiSessionController', () => ({
        listAiSessions: jest.fn((_req, res) => res.json({ sessions: [] })),
        getAiSession: jest.fn((_req, res) => res.json({ session: null })),
        createAiSession: jest.fn((_req, res) => res.status(201).json({ session: {} })),
        resetAiSession: jest.fn((_req, res) => res.json({ ok: true })),
        archiveAiSession: jest.fn((_req, res) => res.json({ ok: true })),
    }));

    return handlers;
};

const mockProductControllers = () => {
    const handlers = {
        getProducts: jest.fn((_req, res) => res.json({ products: [] })),
        getRecommendedProducts: jest.fn((_req, res) => res.json({ products: [] })),
        getProductDealDna: jest.fn((_req, res) => res.json({ dealDna: {} })),
        getProductCompatibility: jest.fn((_req, res) => res.json({ compatibility: {} })),
        getProductReviews: jest.fn((_req, res) => res.json({ reviews: [] })),
        createProductReview: jest.fn((_req, res) => res.status(201).json({ review: {} })),
        buildProductBundle: jest.fn((_req, res) => res.json({ items: [] })),
        visualSearchProducts: jest.fn((_req, res) => res.json({ products: [] })),
        trackProductSearchClick: jest.fn((_req, res) => res.json({ ok: true })),
        getCatalogArtwork: jest.fn((_req, res) => res.type('svg').send('<svg />')),
        getProductImageProxy: jest.fn((_req, res) => res.end()),
        getProductById: jest.fn((_req, res) => res.json({ product: {} })),
        deleteProduct: jest.fn((_req, res) => res.json({ ok: true })),
        createProduct: jest.fn((_req, res) => res.status(201).json({ product: {} })),
        updateProduct: jest.fn((_req, res) => res.json({ product: {} })),
    };

    jest.doMock('../controllers/productController', () => handlers);
    return handlers;
};

describe('production abuse gates', () => {
    afterEach(() => {
        jest.resetModules();
        jest.dontMock('../controllers/aiController');
        jest.dontMock('../controllers/aiSessionController');
        jest.dontMock('../controllers/productController');
        process.env = { ...originalEnv };
    });

    test('anonymous requests cannot reach paid AI chat and voice routes when public AI is disabled', async () => {
        resetProductionGateModules();
        const handlers = mockAiControllers();
        const aiRoutes = require('../routes/aiRoutes');
        const app = buildApp(aiRoutes, '/api/ai');

        const cases = [
            request(app).post('/api/ai/chat').send({ message: 'hello' }),
            request(app).post('/api/ai/chat/stream').send({ message: 'hello' }),
            request(app).post('/api/ai/voice/session').send({ locale: 'en-IN' }),
            request(app).post('/api/ai/voice/speak').send({ text: 'hello' }),
        ];

        for (const pending of cases) {
            const res = await pending;
            expect(res.statusCode).toBe(401);
            expect(res.body.message).toMatch(/not authorized/i);
        }

        expect(handlers.handleAiChat).not.toHaveBeenCalled();
        expect(handlers.handleAiChatStream).not.toHaveBeenCalled();
        expect(handlers.createAiVoiceSession).not.toHaveBeenCalled();
        expect(handlers.synthesizeAiVoiceReply).not.toHaveBeenCalled();
    });

    test('anonymous requests cannot reach visual search provider work', async () => {
        resetProductionGateModules();
        const handlers = mockProductControllers();
        const productRoutes = require('../routes/productRoutes');
        const app = buildApp(productRoutes, '/api/products');

        const res = await request(app)
            .post('/api/products/visual-search')
            .send({ hints: 'phone under 50000' });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/not authorized/i);
        expect(handlers.visualSearchProducts).not.toHaveBeenCalled();
    });
});
