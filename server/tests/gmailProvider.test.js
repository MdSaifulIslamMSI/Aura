jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: jest.fn(), close: jest.fn() })),
}));

const nodemailer = require('nodemailer');
const GmailProvider = require('../services/email/providers/gmailProvider');

const buildProvider = () => new GmailProvider({
    user: 'test@example.com',
    pass: 'app-password',
    fromName: 'Aura Marketplace',
    fromAddress: 'test@example.com',
});

const authRejection = () => Object.assign(
    new Error('Invalid login: 535-5.7.8 Username and Password not accepted'),
    { code: 'EAUTH', responseCode: 535 }
);

describe('Gmail Provider Error Mapping', () => {
    const provider = buildProvider();

    beforeEach(() => {
        nodemailer.createTransport.mockReset();
        nodemailer.createTransport.mockImplementation(() => ({
            sendMail: jest.fn(),
            close: jest.fn(),
        }));
    });

    test('builds the pooled transporter with explicit socket timeouts', () => {
        buildProvider();

        expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({
            pool: true,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000,
        }));
    });

    test('maps auth error as non-retryable', () => {
        const mapped = provider.normalizeError({ code: 'EAUTH', responseCode: 535 });
        expect(mapped.code).toBe('AUTH_FAILED');
        expect(mapped.retryable).toBe(false);
    });

    test('maps recipient envelope error as non-retryable', () => {
        const mapped = provider.normalizeError({ code: 'EENVELOPE', responseCode: 550 });
        expect(mapped.code).toBe('INVALID_RECIPIENT');
        expect(mapped.retryable).toBe(false);
    });

    test('maps network error as retryable', () => {
        const mapped = provider.normalizeError({ code: 'ECONNECTION' });
        expect(mapped.code).toBe('NETWORK_ERROR');
        expect(mapped.retryable).toBe(true);
    });

    test('retries a 535 rejection once on a fresh non-pooled transporter', async () => {
        const retryingProvider = buildProvider();
        retryingProvider.transporter.sendMail.mockRejectedValueOnce(authRejection());
        nodemailer.createTransport.mockImplementationOnce(() => ({
            sendMail: jest.fn().mockResolvedValue({ messageId: 'retry-message-id' }),
            close: jest.fn(),
        }));

        const result = await retryingProvider.sendTransactionalEmail({
            to: 'user@example.com',
            subject: 'Your login code',
            text: '123456',
        });

        expect(result.providerMessageId).toBe('retry-message-id');
        expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
        expect(nodemailer.createTransport.mock.calls[1][0].pool).not.toBe(true);
    });

    test('reports AUTH_FAILED when the retry is rejected too', async () => {
        const retryingProvider = buildProvider();
        retryingProvider.transporter.sendMail.mockRejectedValueOnce(authRejection());
        nodemailer.createTransport.mockImplementationOnce(() => ({
            sendMail: jest.fn().mockRejectedValueOnce(authRejection()),
            close: jest.fn(),
        }));

        await expect(retryingProvider.sendTransactionalEmail({
            to: 'user@example.com',
            subject: 'Your login code',
            text: '123456',
        })).rejects.toMatchObject({
            emailCode: 'AUTH_FAILED',
            emailRetryable: false,
        });

        expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });

    test('does not retry a non-auth failure', async () => {
        const failingProvider = buildProvider();
        failingProvider.transporter.sendMail.mockRejectedValueOnce(Object.assign(
            new Error('Recipient address rejected'),
            { code: 'EENVELOPE', responseCode: 550 }
        ));

        await expect(failingProvider.sendTransactionalEmail({
            to: 'user@example.com',
            subject: 'Your login code',
            text: '123456',
        })).rejects.toMatchObject({
            emailCode: 'INVALID_RECIPIENT',
            emailRetryable: false,
        });

        expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    });
});
