const request = require('supertest');
const app = require('../index');
const mongoose = require('mongoose');

describe('Product API Integration Tests', () => {
    // Test GET /api/products
    test('GET /api/products should return 200 and a list of products', async () => {
        const res = await request(app).get('/api/products');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.products)).toBeTruthy();
        expect(res.body).toHaveProperty('page');
        expect(res.body).toHaveProperty('pages');
    });

    test('GET /api/products accepts relevance sort', async () => {
        const res = await request(app).get('/api/products?sort=relevance&limit=5');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.products)).toBeTruthy();
    });

    test('GET /api/products accepts category filters for mapped fashion lanes', async () => {
        const res = await request(app).get('/api/products?category=men%27s-fashion&limit=5');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.products)).toBeTruthy();
    });

    // Test Validation: Invalid Product ID
    test('GET /api/products/:id should return 400 for invalid ID format', async () => {
        const res = await request(app).get('/api/products/invalid id!');
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
        expect(res.body.errors[0].message).toBe('Invalid Product ID');
    });

    // Test 404: Valid ID format but non-existent product
    test('GET /api/products/:id should return 404 for non-existent product', async () => {
        // Generate a random valid ObjectId
        const validId = '99999999'; // Non-existent numeric ID
        const res = await request(app).get(`/api/products/${validId}`);

        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe('fail'); // AppError format
        expect(res.body.message).toBe('Product not found');
    });
});
