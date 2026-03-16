const request = require('supertest');
const app = require('../index');

describe('Auth Middleware Tests', () => {
    describe('Protected Routes', () => {
        test('GET /api/users/profile should return 401 without token', async () => {
            const res = await request(app).get('/api/users/profile');
            expect(res.statusCode).toBe(401);
            expect(res.body.message).toContain('Not authorized');
        });

        test('GET /api/users/profile should return 401 with invalid token', async () => {
            const res = await request(app)
                .get('/api/users/profile')
                .set('Authorization', 'Bearer invalid-token-123');
            expect(res.statusCode).toBe(401);
        });

        test('PUT /api/users/cart should return 401 without token', async () => {
            const res = await request(app)
                .put('/api/users/cart')
                .send({ cartItems: [] });
            expect(res.statusCode).toBe(401);
        });

        test('PUT /api/users/wishlist should return 401 without token', async () => {
            const res = await request(app)
                .put('/api/users/wishlist')
                .send({ wishlistItems: [] });
            expect(res.statusCode).toBe(401);
        });
    });

    describe('Order Routes Protection', () => {
        test('POST /api/orders should return 401 without token', async () => {
            const res = await request(app)
                .post('/api/orders')
                .send({ orderItems: [] });
            expect(res.statusCode).toBe(401);
        });

        test('GET /api/orders/myorders should return 401 without token', async () => {
            const res = await request(app).get('/api/orders/myorders');
            expect(res.statusCode).toBe(401);
        });
    });
});
