const { z } = require('zod');

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
}));

const logger = require('../utils/logger');
const validate = require('../middleware/validate');

describe('validate middleware logging policy', () => {
    const originalEnv = process.env.LOG_VALIDATION_WARNINGS;

    afterEach(() => {
        process.env.LOG_VALIDATION_WARNINGS = originalEnv;
        jest.clearAllMocks();
    });

    test('logs zod validation failures at debug by default and returns 400 contract', async () => {
        delete process.env.LOG_VALIDATION_WARNINGS;
        const middleware = validate(z.object({ body: z.object({ email: z.string().email() }) }));

        const req = { body: { email: 'invalid' }, query: {}, params: {}, originalUrl: '/users' };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const next = jest.fn();

        await middleware(req, res, next);

        expect(logger.debug).toHaveBeenCalledWith(
            'request.validation_failed',
            expect.objectContaining({ path: '/users', issues: expect.any(Array) })
        );
        expect(logger.warn).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Validation Error',
                code: 'VALIDATION_FAILED',
                errors: expect.any(Array),
            })
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('logs zod validation failures at warn when LOG_VALIDATION_WARNINGS=true', async () => {
        process.env.LOG_VALIDATION_WARNINGS = 'true';
        const middleware = validate(z.object({ body: z.object({ email: z.string().email() }) }));

        const req = { body: { email: 'invalid' }, query: {}, params: {}, originalUrl: '/users' };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await middleware(req, res, jest.fn());

        expect(logger.warn).toHaveBeenCalledWith(
            'request.validation_failed',
            expect.objectContaining({ path: '/users', issues: expect.any(Array) })
        );
        expect(logger.debug).not.toHaveBeenCalled();
    });

    test('logs unexpected validation exceptions and returns 500', async () => {
        const middleware = validate({
            parseAsync: jest.fn().mockRejectedValue(new Error('boom')),
        });
        const req = { body: {}, query: {}, params: {}, originalUrl: '/users' };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await middleware(req, res, jest.fn());

        expect(logger.error).toHaveBeenCalledWith(
            'request.validation_unexpected_error',
            expect.objectContaining({ error: 'boom', path: '/users' })
        );
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: 'Internal Server Error during validation' });
    });
});
