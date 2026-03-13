describe('Email Gateway Security', () => {
    const originalEnv = { ...process.env };

    const loadGateway = ({ providerSendMock } = {}) => {
        jest.resetModules();
        jest.doMock('../services/email/emailProviderFactory', () => ({
            getEmailProvider: () => ({
                sendTransactionalEmail: providerSendMock || jest.fn().mockResolvedValue({
                    provider: 'gmail',
                    providerMessageId: 'msg_test',
                    response: {},
                }),
            }),
        }));
        // eslint-disable-next-line global-require
        return require('../services/email');
    };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects missing eventType in strict mode', async () => {
        process.env.ORDER_EMAILS_ENABLED = 'true';
        process.env.EMAIL_SECURITY_ENABLED = 'true';
        process.env.EMAIL_SECURITY_STRICT_MODE = 'true';

        const gateway = loadGateway();
        await expect(gateway.sendTransactionalEmail({
            to: 'user@test.com',
            subject: 'Security notice',
            text: 'hello',
        })).rejects.toThrow('eventType is required');
    });

    test('rejects subject over configured limit', async () => {
        process.env.ORDER_EMAILS_ENABLED = 'true';
        process.env.EMAIL_SECURITY_ENABLED = 'true';
        process.env.EMAIL_SECURITY_STRICT_MODE = 'true';
        process.env.EMAIL_SECURITY_MAX_SUBJECT_LEN = '20';

        const gateway = loadGateway();
        await expect(gateway.sendTransactionalEmail({
            eventType: 'system',
            to: 'user@test.com',
            subject: 'This subject is intentionally longer than twenty chars',
            text: 'hello',
        })).rejects.toThrow('subject exceeds limit');
    });

    test('sends sanitized payload with default security headers', async () => {
        process.env.ORDER_EMAILS_ENABLED = 'true';
        process.env.EMAIL_SECURITY_ENABLED = 'true';
        process.env.EMAIL_SECURITY_STRICT_MODE = 'true';

        const providerSendMock = jest.fn().mockResolvedValue({
            provider: 'gmail',
            providerMessageId: 'msg_ok',
            response: {},
        });
        const gateway = loadGateway({ providerSendMock });

        await gateway.sendTransactionalEmail({
            eventType: 'otp_security',
            to: 'user@test.com',
            subject: 'Aura OTP Security Code',
            text: 'OTP body',
            headers: {
                'X-Aura-Test': 'ok',
                'bad header': 'should_be_dropped',
            },
            requestId: 'req_123',
            securityTags: ['otp', 'security'],
        });

        expect(providerSendMock).toHaveBeenCalledTimes(1);
        const payload = providerSendMock.mock.calls[0][0];
        expect(payload.headers['X-Aura-Event-Type']).toBe('otp_security');
        expect(payload.headers['X-Aura-Message-Version']).toBe('security-v3');
        expect(payload.headers['X-Request-Id']).toBe('req_123');
        expect(payload.headers['X-Aura-Test']).toBe('ok');
        expect(payload.headers['bad header']).toBeUndefined();
    });

    test('buildEmailAuditRecord returns normalized audit shape', () => {
        process.env.ORDER_EMAILS_ENABLED = 'true';
        const gateway = loadGateway();

        const record = gateway.buildEmailAuditRecord({
            eventType: 'system',
            requestId: 'req_123',
            recipientMask: 'us***@mail.com',
            provider: 'gmail',
            status: 'sent',
            errorCode: '',
        });

        expect(record).toEqual({
            eventType: 'system',
            requestId: 'req_123',
            recipient: 'us***@mail.com',
            provider: 'gmail',
            status: 'sent',
            errorCode: '',
        });
    });
});

