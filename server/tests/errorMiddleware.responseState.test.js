jest.mock('../utils/logger', () => ({
    error: jest.fn(),
}));
jest.mock('../security/invisibleFabric/responseMinimizer', () => ({
    buildMinimizedErrorResponse: jest.fn(() => null),
}));

const { errorHandler } = require('../middleware/errorMiddleware');

describe('error middleware response-state guard', () => {
    test.each([
        ['headers already sent', { headersSent: true }],
        ['response already ended', { writableEnded: true }],
        ['response destroyed', { destroyed: true }],
    ])('delegates late errors when the %s', (_label, responseState) => {
        const error = new Error('late controller failure');
        const req = {
            headers: {},
            method: 'POST',
            originalUrl: '/api/auth/mfa/passkey/login/verify',
            requestId: 'late-error-test',
        };
        const res = {
            headersSent: false,
            writableEnded: false,
            destroyed: false,
            status: jest.fn(),
            json: jest.fn(),
            ...responseState,
        };
        const next = jest.fn();

        errorHandler(error, req, res, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});
