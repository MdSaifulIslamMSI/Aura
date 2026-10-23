const request = require('supertest');

jest.mock('../services/reviewMediaStorageService', () => ({
    buildReviewMediaStorageKey: jest.fn((assetPath) => `reviews/${assetPath}`),
    getReviewMediaObject: jest.fn(async () => ({
        contentType: 'image/png',
        contentLength: 4,
        body: Buffer.from([1, 2, 3, 4]),
    })),
}));
jest.mock('../services/avatarMediaStorageService', () => ({
    getAvatarMediaObject: jest.fn(async () => ({
        contentType: 'image/webp',
        contentLength: 3,
        body: Buffer.from([5, 6, 7]),
    })),
}));

const { getReviewMediaObject } = require('../services/reviewMediaStorageService');
const app = require('../index');

describe('upload asset routing', () => {
    beforeEach(() => jest.clearAllMocks());

    test('serves review media only through the controller route', async () => {
        const response = await request(app).get('/uploads/reviews/2026/receipt.png');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/image\/png/);
        expect(getReviewMediaObject).toHaveBeenCalledWith({
            storageKey: 'reviews/2026/receipt.png',
        });
    });

    test('serves avatar media only through the controller route', async () => {
        const response = await request(app).get('/uploads/avatars/u1abcd.webp');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/image\/webp/);
        expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('does not expose arbitrary files under the uploads directory', async () => {
        const response = await request(app).get('/uploads/secret.txt');

        expect(response.status).toBe(404);
        expect(getReviewMediaObject).not.toHaveBeenCalled();
    });
});
