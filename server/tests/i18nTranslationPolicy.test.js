const {
    requireAuthForHeavyTranslation,
} = require('../middleware/i18nTranslationPolicy');

const originalEnv = { ...process.env };

const createResponse = () => {
    const response = {
        json: jest.fn(),
        status: jest.fn(),
    };
    response.status.mockReturnValue(response);
    return response;
};

describe('i18nTranslationPolicy', () => {
    beforeEach(() => {
        process.env = {
            ...originalEnv,
            I18N_TRANSLATION_REQUIRE_AUTH_FOR_HEAVY_USAGE: 'true',
        };
    });

    afterAll(() => {
        process.env = { ...originalEnv };
    });

    test('allows small anonymous translation batches', () => {
        const next = jest.fn();
        const response = createResponse();

        requireAuthForHeavyTranslation({
            body: { texts: ['Small listing title'] },
        }, response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(response.status).not.toHaveBeenCalled();
    });

    test('requires auth for heavy anonymous translation batches', () => {
        const next = jest.fn();
        const response = createResponse();

        requireAuthForHeavyTranslation({
            body: { texts: Array.from({ length: 11 }, (_, index) => `Listing ${index}`) },
        }, response, next);

        expect(next).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'I18N_TRANSLATION_AUTH_REQUIRED',
        }));
    });

    test('allows authenticated users to use bounded heavy batches', () => {
        const next = jest.fn();
        const response = createResponse();

        requireAuthForHeavyTranslation({
            body: { texts: Array.from({ length: 25 }, (_, index) => `Listing ${index}`) },
            user: { _id: 'user-1' },
        }, response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(response.status).not.toHaveBeenCalled();
    });
});
