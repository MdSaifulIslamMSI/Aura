const ORIGINAL_ENV = { ...process.env };

const restoreEnv = () => {
    process.env = { ...ORIGINAL_ENV };
};

afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    restoreEnv();
});

describe('SMS service coverage', () => {
    test('SMS provider factory falls back to mock provider and caches the instance', async () => {
        process.env.OTP_SMS_PROVIDER = 'unknown-provider';
        const logger = {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };

        jest.doMock('../utils/logger', () => logger);

        let factory;
        jest.isolateModules(() => {
            factory = require('../services/sms/smsProviderFactory');
        });

        const providerA = factory.getSmsProvider();
        const providerB = factory.getSmsProvider();
        const message = await providerA.sendOtpSms({ toPhone: '+919876543210', body: 'test-body' });

        expect(providerA).toBe(providerB);
        expect(message.provider).toBe('mock');
        expect(message.channel).toBe('sms');
        expect(logger.warn).toHaveBeenCalledWith('sms.provider_unknown_fallback', expect.objectContaining({
            requestedProvider: 'unknown-provider',
            fallbackProvider: 'mock',
        }));
    });

    test('sendOtpSms falls back from WhatsApp to SMS and exposes channel helpers', async () => {
        process.env.OTP_SMS_PROVIDER = 'twilio';
        process.env.OTP_WHATSAPP_ENABLED = 'true';

        const logger = {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };
        const sendOtpSmsMock = jest.fn()
            .mockRejectedValueOnce(Object.assign(new Error('whatsapp failed'), { smsCode: 'WA_FAIL' }))
            .mockResolvedValueOnce({
                provider: 'twilio',
                channel: 'sms',
                providerMessageId: 'sms-1',
                response: { accepted: true },
            });

        jest.doMock('../utils/logger', () => logger);
        jest.doMock('../services/sms/smsProviderFactory', () => ({
            getSmsProvider: () => ({
                sendOtpSms: sendOtpSmsMock,
            }),
        }));

        let smsService;
        jest.isolateModules(() => {
            smsService = require('../services/sms');
        });

        const result = await smsService.sendOtpSms({
            toPhone: '9876543210',
            otp: '654321',
            purpose: 'login',
            context: {
                ip: '::ffff:127.0.0.1',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
                requestTime: '2026-03-05T12:00:00.000Z',
            },
            requestId: 'req-1',
        });

        expect(result).toEqual(expect.objectContaining({
            provider: 'twilio',
            channel: 'sms',
            providerMessageId: 'sms-1',
        }));
        expect(sendOtpSmsMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            toPhone: '+919876543210',
            channel: 'whatsapp',
        }));
        expect(sendOtpSmsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            toPhone: '+919876543210',
            channel: 'sms',
        }));
        expect(logger.warn).toHaveBeenCalledWith('otp_sms.channel_failed', expect.objectContaining({
            requestId: 'req-1',
            channel: 'whatsapp',
        }));
        expect(logger.info).toHaveBeenCalledWith('otp_sms.sent', expect.objectContaining({
            requestId: 'req-1',
            channel: 'sms',
        }));
        expect(smsService.getOtpMobileChannels()).toEqual(['whatsapp', 'sms']);
        expect(smsService.normalizePhoneE164('+15551234567')).toBe('+15551234567');
        expect(smsService.normalizePhoneE164('9876543210')).toBe('+919876543210');
        expect(smsService.buildOtpSmsContext({
            purpose: 'payment-challenge',
            ip: '2001:db8::1',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1',
            requestTime: '2026-03-05T12:00:00.000Z',
        })).toEqual(expect.objectContaining({
            purposeLabel: 'Payment Challenge',
            maskedIp: '2001:db8:****',
            deviceLabel: 'Mobile - Safari',
        }));
    });

    test('sendOtpSms throws structured failures when all channels fail and validates payload', async () => {
        process.env.OTP_SMS_PROVIDER = 'mock';
        process.env.OTP_WHATSAPP_ENABLED = 'false';

        const logger = {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };
        const sendOtpSmsMock = jest.fn()
            .mockRejectedValue(Object.assign(new Error('sms failed'), { smsCode: 'SMS_FAIL' }));

        jest.doMock('../utils/logger', () => logger);
        jest.doMock('../services/sms/smsProviderFactory', () => ({
            getSmsProvider: () => ({
                sendOtpSms: sendOtpSmsMock,
            }),
        }));

        let smsService;
        jest.isolateModules(() => {
            smsService = require('../services/sms');
        });

        await expect(smsService.sendOtpSms({
            toPhone: '',
            otp: '123456',
            purpose: 'login',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: 'OTP SMS payload is incomplete',
        });

        await expect(smsService.sendOtpSms({
            toPhone: '111',
            otp: '123456',
            purpose: 'login',
            requestId: 'req-2',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: 'Invalid phone number format for OTP SMS',
        });

        await expect(smsService.sendOtpSms({
            toPhone: '9876543210',
            otp: '123456',
            purpose: 'login',
            requestId: 'req-3',
        })).rejects.toMatchObject({
            statusCode: 503,
            smsCode: 'SMS_FAIL',
            smsRetryable: true,
            smsFailures: [expect.objectContaining({ channel: 'sms', code: 'SMS_FAIL' })],
        });
        expect(logger.error).toHaveBeenCalledWith('otp_sms.failed', expect.objectContaining({
            requestId: 'req-3',
            code: 'SMS_FAIL',
        }));
        expect(smsService.getOtpMobileChannels()).toEqual(['sms']);
    });
});

describe('Email gateway coverage', () => {
    test('email provider factory caches Gmail provider and rejects unsupported providers', () => {
        process.env.ORDER_EMAIL_PROVIDER = 'gmail';
        process.env.GMAIL_USER = 'sender@example.com';
        process.env.GMAIL_APP_PASSWORD = 'secret';

        const GmailProviderMock = jest.fn().mockImplementation(function GmailProvider(opts) {
            this.opts = opts;
            this.marker = Symbol('gmail-provider');
        });

        jest.doMock('../services/email/providers/gmailProvider', () => GmailProviderMock);

        let factory;
        jest.isolateModules(() => {
            factory = require('../services/email/emailProviderFactory');
        });

        const providerA = factory.getEmailProvider();
        const providerB = factory.getEmailProvider();
        expect(providerA).toBe(providerB);
        expect(GmailProviderMock).toHaveBeenCalledTimes(1);

        factory.resetEmailProviderForTests();
        const providerC = factory.getEmailProvider();
        expect(providerC).not.toBe(providerA);
        expect(GmailProviderMock).toHaveBeenCalledTimes(2);

        jest.resetModules();
        restoreEnv();
        process.env.ORDER_EMAIL_PROVIDER = 'unsupported';
        jest.isolateModules(() => {
            factory = require('../services/email/emailProviderFactory');
        });
        expect(() => factory.getEmailProvider()).toThrow('Unsupported email provider: unsupported');
    });

    test('sendTransactionalEmail validates payloads, skips disabled order mail, and sanitizes headers/meta', async () => {
        process.env.ORDER_EMAILS_ENABLED = 'false';

        let emailGateway;
        jest.isolateModules(() => {
            emailGateway = require('../services/email');
        });

        const skipped = await emailGateway.sendTransactionalEmail({
            eventType: 'order_placed',
            to: 'customer@example.com',
            subject: 'Order placed',
            text: 'Thank you',
        });
        expect(skipped).toEqual({
            skipped: true,
            provider: 'disabled',
            providerMessageId: '',
            response: { reason: 'ORDER_EMAILS_ENABLED=false' },
        });

        const provider = {
            sendTransactionalEmail: jest.fn().mockResolvedValue({
                provider: 'gmail',
                providerMessageId: 'msg-1',
                response: { accepted: ['customer@example.com'] },
            }),
        };
        const logger = {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };

        jest.resetModules();
        restoreEnv();
        process.env.ORDER_EMAILS_ENABLED = 'true';
        process.env.EMAIL_FORTRESS_STRICT_MODE = 'true';
        jest.doMock('../services/email/emailProviderFactory', () => ({
            getEmailProvider: () => provider,
        }));
        jest.doMock('../utils/logger', () => logger);

        jest.isolateModules(() => {
            emailGateway = require('../services/email');
        });

        await expect(emailGateway.sendTransactionalEmail({
            to: 'customer@example.com',
            subject: 'Missing event type',
            text: 'Body',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: 'eventType is required in strict email fortress mode',
        });

        await expect(emailGateway.sendTransactionalEmail({
            eventType: 'otp_security',
            to: 'bad-recipient',
            subject: 'Invalid recipient',
            text: 'Body',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: 'Recipient email format is invalid',
        });

        const result = await emailGateway.sendTransactionalEmail({
            eventType: 'otp_security',
            to: ['Customer@example.com', 'second@example.com'],
            subject: 'Security alert',
            html: '<b>Hello</b>',
            text: 'Hello',
            headers: {
                'X-Allowed': 'ok',
                'Bad Header': 'nope',
                'X-Too-Long': 'a'.repeat(513),
            },
            meta: {
                nested: { ok: true },
            },
            requestId: 'req-email-1',
            securityTags: ['otp', 'security'],
        });

        expect(result.provider).toBe('gmail');
        expect(provider.sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'customer@example.com, second@example.com',
            subject: 'Security alert',
            headers: expect.objectContaining({
                'X-Allowed': 'ok',
                'X-Aura-Event-Type': 'otp_security',
                'X-Aura-Message-Version': 'fortress-v3',
                'X-Request-Id': 'req-email-1',
            }),
            meta: expect.objectContaining({
                nested: { ok: true },
                securityTags: ['otp', 'security'],
            }),
        }));
        expect(logger.info).toHaveBeenCalledWith('email_gateway.sent', expect.objectContaining({
            eventType: 'otp_security',
            requestId: 'req-email-1',
            status: 'sent',
        }));
    });

    test('sendTransactionalEmail logs and rethrows provider failures', async () => {
        const provider = {
            sendTransactionalEmail: jest.fn().mockRejectedValue(
                Object.assign(new Error('provider down'), { emailCode: 'RATE_LIMIT', code: 'RATE_LIMIT' })
            ),
        };
        const logger = {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };

        jest.doMock('../services/email/emailProviderFactory', () => ({
            getEmailProvider: () => provider,
        }));
        jest.doMock('../utils/logger', () => logger);

        let emailGateway;
        jest.isolateModules(() => {
            emailGateway = require('../services/email');
        });

        await expect(emailGateway.sendTransactionalEmail({
            eventType: 'system',
            to: 'customer@example.com',
            subject: 'System notice',
            text: 'Body',
            requestId: 'req-email-2',
        })).rejects.toThrow('provider down');

        expect(logger.error).toHaveBeenCalledWith('email_gateway.failed', expect.objectContaining({
            eventType: 'system',
            requestId: 'req-email-2',
            status: 'failed',
            errorCode: 'RATE_LIMIT',
        }));
    });
});
