jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../models/Product', () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../models/User', () => ({
    updateMany: jest.fn(),
}));

jest.mock('../models/ProductGovernanceLog', () => ({
    create: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../services/catalogService', () => ({
    createManualProduct: jest.fn(),
    updateManualProduct: jest.fn(),
    deleteManualProduct: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminProductRoutes = require('../routes/adminProductRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const Product = require('../models/Product');
const User = require('../models/User');
const ProductGovernanceLog = require('../models/ProductGovernanceLog');
const {
    createManualProduct,
    updateManualProduct,
    deleteManualProduct,
} = require('../services/catalogService');

const makeProductDoc = (overrides = {}) => ({
    _id: '69bb00000000000000000001',
    id: 1001,
    externalId: 'manual-product-1001',
    source: 'manual',
    catalogVersion: 'legacy-v1',
    isPublished: true,
    title: 'Aura Phone X',
    brand: 'AuraTech',
    category: 'Mobiles',
    subCategory: 'Smartphones',
    price: 24999,
    originalPrice: 29999,
    discountPercentage: 16.67,
    image: 'https://example.com/images/aura-phone-x.jpg',
    stock: 12,
    rating: 4.6,
    ratingCount: 980,
    description: 'Flagship device with premium display and battery life.',
    highlights: ['AMOLED display', 'Fast charging'],
    specifications: [{ key: 'RAM', value: '8GB' }],
    deliveryTime: '2-4 days',
    warranty: '1 year',
    adCampaign: { isSponsored: false, status: 'inactive' },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-05T00:00:00.000Z'),
    toObject() {
        return {
            _id: this._id,
            id: this.id,
            externalId: this.externalId,
            source: this.source,
            catalogVersion: this.catalogVersion,
            isPublished: this.isPublished,
            title: this.title,
            brand: this.brand,
            category: this.category,
            subCategory: this.subCategory,
            price: this.price,
            originalPrice: this.originalPrice,
            discountPercentage: this.discountPercentage,
            image: this.image,
            stock: this.stock,
            rating: this.rating,
            ratingCount: this.ratingCount,
            description: this.description,
            highlights: this.highlights,
            specifications: this.specifications,
            deliveryTime: this.deliveryTime,
            warranty: this.warranty,
            adCampaign: this.adCampaign,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    },
    ...overrides,
});

const makeListChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const makeFindOneChain = (result) => ({
    sort: jest.fn().mockResolvedValue(result),
});

const makeFindByIdChain = (result) => ({
    select: jest.fn().mockResolvedValue(result),
});

const makeLogChain = (result) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/products', adminProductRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin product routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();

        Product.find.mockReturnValue(makeListChain([makeProductDoc()]));
        Product.findOne.mockReturnValue(makeFindOneChain(makeProductDoc()));
        Product.findById.mockReturnValue(makeFindByIdChain(makeProductDoc()));
        Product.countDocuments.mockResolvedValue(1);

        ProductGovernanceLog.create.mockResolvedValue({ actionId: 'pgl_1' });
        ProductGovernanceLog.find.mockReturnValue(makeLogChain([]));
        User.updateMany.mockResolvedValue({ modifiedCount: 1 });

        createManualProduct.mockResolvedValue({ _id: '69bb00000000000000000001' });
        updateManualProduct.mockResolvedValue({ _id: '69bb00000000000000000001' });
        deleteManualProduct.mockResolvedValue({ message: 'Product removed' });
    });

    test('GET /api/admin/products returns paginated admin products', async () => {
        const res = await request(app).get('/api/admin/products?page=1&limit=20&search=Aura');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            total: 1,
            page: 1,
            limit: 20,
        });
        expect(res.body.products).toHaveLength(1);
        expect(res.body.products[0].title).toBe('Aura Phone X');
    });

    test('GET /api/admin/products/:id returns product detail with governance logs', async () => {
        ProductGovernanceLog.find.mockReturnValue(makeLogChain([
            {
                actionId: 'pgl_1',
                actionType: 'update_core',
                actorEmail: 'admin@example.com',
                reason: 'Updated headline copy',
                createdAt: new Date('2026-03-05T12:00:00.000Z'),
                changeSet: { title: { before: 'Aura Old', after: 'Aura Phone X' } },
            },
        ]));

        const res = await request(app).get('/api/admin/products/1001');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.product.title).toBe('Aura Phone X');
        expect(res.body.logs).toHaveLength(1);
    });

    test('GET /api/admin/products/:id/logs returns governance timeline', async () => {
        ProductGovernanceLog.find.mockReturnValue(makeLogChain([
            {
                actionId: 'pgl_2',
                actionType: 'delete',
                actorEmail: 'admin@example.com',
                reason: 'Removed broken listing',
                createdAt: new Date('2026-03-05T15:00:00.000Z'),
                changeSet: {},
                beforeSnapshot: { title: 'Aura Phone X' },
                afterSnapshot: null,
            },
        ]));

        const res = await request(app).get('/api/admin/products/1001/logs');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.productRef).toBe('1001');
        expect(res.body.logs).toHaveLength(1);
    });

    test('POST /api/admin/products enforces schema validation', async () => {
        const res = await request(app)
            .post('/api/admin/products')
            .send({
                title: 'No',
                price: 100,
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('POST /api/admin/products creates a product through the real route', async () => {
        const res = await request(app)
            .post('/api/admin/products')
            .send({
                title: 'Aura Laptop Z',
                price: 99999,
                originalPrice: 109999,
                description: 'High-end laptop configured for professional workloads and sustained performance.',
                category: 'Laptops',
                subCategory: 'Ultrabooks',
                brand: 'AuraCompute',
                image: 'https://example.com/images/aura-laptop-z.jpg',
                stock: 6,
                deliveryTime: '3-5 days',
                warranty: '2 years',
                highlights: ['OLED display', '32GB RAM'],
                specifications: [{ key: 'Processor', value: 'Aura X1' }],
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.message).toBe('Product created successfully');
        expect(createManualProduct).toHaveBeenCalled();
        expect(res.body.product.title).toBe('Aura Phone X');
    });

    test('PATCH /api/admin/products/:id/core enforces at least one core field', async () => {
        const res = await request(app)
            .patch('/api/admin/products/1001/core')
            .send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('PATCH /api/admin/products/:id/core updates the existing product and refreshes user projections', async () => {
        const persisted = makeProductDoc({
            title: 'Aura Phone X Pro',
            description: 'Updated flagship device with better optics and thermals.',
            highlights: ['AMOLED display', 'Periscope zoom'],
        });
        Product.findOne.mockReturnValue(makeFindOneChain(makeProductDoc()));
        Product.findById.mockReturnValue(makeFindByIdChain(persisted));

        const res = await request(app)
            .patch('/api/admin/products/1001/core')
            .send({
                title: 'Aura Phone X Pro',
                description: 'Updated flagship device with better optics and thermals.',
                reason: 'Refresh core product copy',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Product core details updated');
        expect(updateManualProduct).toHaveBeenCalledWith('69bb00000000000000000001', expect.objectContaining({
            title: 'Aura Phone X Pro',
        }));
        expect(User.updateMany).toHaveBeenCalled();
        expect(res.body.product.title).toBe('Aura Phone X Pro');
    });

    test('PATCH /api/admin/products/:id/pricing rejects selling price above original price', async () => {
        const res = await request(app)
            .patch('/api/admin/products/1001/pricing')
            .send({
                price: 40000,
                originalPrice: 35000,
                reason: 'Broken pricing update',
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Selling price cannot be greater than original price');
    });

    test('PATCH /api/admin/products/:id/pricing updates pricing and refreshes user projections', async () => {
        const persisted = makeProductDoc({
            price: 21999,
            originalPrice: 29999,
            discountPercentage: 26.67,
        });
        Product.findById.mockReturnValue(makeFindByIdChain(persisted));

        const res = await request(app)
            .patch('/api/admin/products/1001/pricing')
            .send({
                price: 21999,
                originalPrice: 29999,
                reason: 'Campaign price refresh',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Product pricing updated');
        expect(updateManualProduct).toHaveBeenCalledWith('69bb00000000000000000001', expect.objectContaining({
            price: 21999,
            originalPrice: 29999,
        }));
        expect(User.updateMany).toHaveBeenCalled();
    });

    test('DELETE /api/admin/products/:id removes the product and clears user collections', async () => {
        const res = await request(app)
            .delete('/api/admin/products/1001')
            .send({ reason: 'Remove deprecated catalog item' });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Product removed');
        expect(deleteManualProduct).toHaveBeenCalledWith('69bb00000000000000000001');
        expect(User.updateMany).toHaveBeenCalledTimes(2);
    });
});
