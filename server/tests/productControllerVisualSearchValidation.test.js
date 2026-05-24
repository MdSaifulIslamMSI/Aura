jest.mock('../services/ai/multimodalVisualSearchService', () => ({
    runMultimodalVisualSearch: jest.fn().mockResolvedValue({ matches: [], querySignals: {} }),
}));

const { runMultimodalVisualSearch } = require('../services/ai/multimodalVisualSearchService');
const { visualSearchProducts } = require('../controllers/productController');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('productController visual search upload validation', () => {
    test('rejects visual search image data URI magic-byte mismatch before model work', async () => {
        const req = {
            body: {
                imageDataUrl: `data:image/jpeg;base64,${pngBase64}`,
                fileName: 'search.jpg',
                imageMeta: { mimeType: 'image/jpeg', source: 'upload' },
                limit: 12,
            },
            user: { _id: 'user-1' },
            market: null,
        };
        const res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        await visualSearchProducts(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Visual search image content does not match declared image type',
            statusCode: 400,
        }));
        expect(runMultimodalVisualSearch).not.toHaveBeenCalled();
    });
});
