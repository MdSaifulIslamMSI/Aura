const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../index');
const User = require('../models/User');
const Listing = require('../models/Listing');

describe('Listing routes integration', () => {
    test('GET /api/listings/hotspots returns hotspot intelligence without crashing', async () => {
        const seller = await User.create({
            name: 'Hotspot Seller',
            email: 'seller.hotspot@example.com',
            phone: '7776665554',
            isVerified: true,
            isSeller: true,
        });

        await Listing.create([
            {
                seller: seller._id,
                title: 'Gaming Chair',
                description: 'Ergonomic chair',
                price: 12500,
                condition: 'good',
                category: 'gaming',
                images: ['https://example.com/chair.jpg'],
                location: {
                    city: 'Bengaluru',
                    state: 'Karnataka',
                    pincode: '560001',
                },
                status: 'active',
                source: 'user',
                views: 240,
            },
            {
                seller: seller._id,
                title: 'Gaming Monitor',
                description: '165Hz monitor',
                price: 19500,
                condition: 'good',
                category: 'gaming',
                images: ['https://example.com/monitor.jpg'],
                location: {
                    city: 'Bengaluru',
                    state: 'Karnataka',
                    pincode: '560001',
                },
                status: 'sold',
                soldAt: new Date(),
                source: 'user',
                views: 180,
            },
        ]);

        const res = await request(app).get('/api/listings/hotspots?limit=4&windowDays=21');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.hotspots)).toBe(true);
        expect(Array.isArray(res.body.demandCentroids)).toBe(true);
    });

    test('GET /api/listings/:id returns strict public seller payload without email/phone', async () => {
        const seller = await User.create({
            name: 'Seller One',
            email: 'seller.one@example.com',
            phone: '9998887776',
            isVerified: true,
            isSeller: true,
        });

        const listing = await Listing.create({
            seller: seller._id,
            title: 'Gaming Laptop',
            description: 'RTX laptop in good condition',
            price: 75000,
            condition: 'good',
            category: 'laptops',
            images: ['https://example.com/laptop.jpg'],
            location: {
                city: 'Bengaluru',
                state: 'Karnataka',
                pincode: '560001',
            },
            status: 'active',
            source: 'user',
        });

        const res = await request(app).get(`/api/listings/${listing._id}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.listing.seller).toMatchObject({
            name: 'Seller One',
            isVerified: true,
        });
        expect(res.body.listing.seller).not.toHaveProperty('email');
        expect(res.body.listing.seller).not.toHaveProperty('phone');
        expect(res.body.listing.seller).toHaveProperty('createdAt');
    });

    test('GET /api/listings/:id does not leak email/phone to unauthenticated callers', async () => {
        const seller = await User.create({
            name: 'Seller Two',
            email: 'seller.two@example.com',
            phone: '8887776665',
            isVerified: false,
            isSeller: true,
        });

        const listing = await Listing.create({
            seller: seller._id,
            title: 'Study Table',
            description: 'Wooden study table',
            price: 3500,
            condition: 'fair',
            category: 'furniture',
            images: ['https://example.com/table.jpg'],
            location: {
                city: 'Pune',
                state: 'Maharashtra',
                pincode: '411001',
            },
            status: 'active',
            source: 'user',
        });

        const res = await request(app).get(`/api/listings/${listing._id}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.listing.seller).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(res.body.listing.seller, 'email')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(res.body.listing.seller, 'phone')).toBe(false);
        expect(mongoose.isValidObjectId(res.body.listing.seller._id)).toBe(true);
    });
});
