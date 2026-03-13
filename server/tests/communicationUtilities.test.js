const ORIGINAL_ENV = { ...process.env };

const restoreEnv = () => {
    process.env = { ...ORIGINAL_ENV };
};

afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    restoreEnv();
});

describe('Communication utility coverage', () => {
    test('template utils sanitize, format, and derive device/network context', () => {
        const utils = require('../services/email/templateUtils');

        expect(utils.escapeHtml('<tag>"quoted"&\'apostrophe\'')).toBe('&lt;tag&gt;&quot;quoted&quot;&amp;&#39;apostrophe&#39;');
        expect(utils.toCurrency(2459)).toContain('₹');
        expect(utils.toReadableDateTime('not-a-date')).toBe('-');
        expect(utils.compactAddress({
            address: '221B Baker Street',
            city: 'London',
            postalCode: 'NW16XE',
            country: 'UK',
        })).toBe('221B Baker Street, London, NW16XE, UK');

        expect(utils.maskIpAddress('::ffff:127.0.0.1')).toBe('127.0.x.x');
        expect(utils.maskIpAddress('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:****');
        expect(utils.maskIpAddress('')).toBe('Unavailable');
        expect(utils.maskIpAddress('hostname')).toBe('Masked');

        expect(utils.getDeviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1'))
            .toBe('Mobile - Safari');
        expect(utils.getDeviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'))
            .toBe('Desktop - Chrome');
        expect(utils.getDeviceLabelFromUserAgent('')).toBe('Unknown device');

        const timestamp = utils.toIstUtcTimestamp('2026-03-05T12:00:00.000Z');
        expect(timestamp.ist).toContain('2026');
        expect(timestamp.utc).toContain('2026-03-05 12:00:00.000');
        expect(timestamp.display).toContain('IST');
        expect(utils.toIstUtcTimestamp('bad-value')).toEqual({
            ist: '-',
            utc: '-',
            display: '-',
        });
    });

    test('OTP SMS template renders context and falls back to login purpose', () => {
        const { renderOtpSmsTemplate } = require('../services/sms/templates/otpSmsTemplate');

        const rendered = renderOtpSmsTemplate({
            otp: '123456',
            purpose: 'unknown-purpose',
            context: {
                requestTime: 'Mar 05, 2026',
                deviceLabel: 'Desktop - Chrome',
                maskedIp: '127.0.x.x',
                locationLabel: 'Kolkata',
            },
            brand: 'AURA',
            ttlMinutes: 'bad-number',
        });

        expect(rendered.body).toContain('AURA: 123456 is your OTP for login verification.');
        expect(rendered.body).toContain('Valid for 5 min.');
        expect(rendered.body).toContain('Device: Desktop - Chrome.');
        expect(rendered.body).toContain('IP: 127.0.x.x.');
        expect(rendered.body).toContain('Loc: Kolkata.');
    });

    test('OTP SMS flags parse booleans and enforce production Twilio requirements', () => {
        process.env.NODE_ENV = 'production';
        process.env.OTP_SMS_ENABLED = 'yes';
        process.env.OTP_SMS_PROVIDER = 'mock';

        let otpSmsFlags;
        jest.isolateModules(() => {
            otpSmsFlags = require('../config/otpSmsFlags');
        });

        expect(otpSmsFlags.parseBoolean('on')).toBe(true);
        expect(otpSmsFlags.parseBoolean('off', true)).toBe(false);
        expect(otpSmsFlags.parseInteger('999', 5, { min: 1, max: 30 })).toBe(30);
        expect(otpSmsFlags.parseInteger('0', 5, { min: 1, max: 30 })).toBe(1);
        expect(() => otpSmsFlags.assertProductionOtpSmsConfig())
            .toThrow('OTP_SMS_PROVIDER must be "twilio" in production when OTP_SMS_ENABLED=true');

        process.env.OTP_SMS_PROVIDER = 'twilio';
        process.env.TWILIO_ACCOUNT_SID = 'sid';
        process.env.TWILIO_AUTH_TOKEN = 'token';
        process.env.TWILIO_FROM_NUMBER = '+15555555555';
        process.env.OTP_WHATSAPP_ENABLED = 'true';

        jest.resetModules();
        jest.isolateModules(() => {
            otpSmsFlags = require('../config/otpSmsFlags');
        });

        expect(() => otpSmsFlags.assertProductionOtpSmsConfig())
            .toThrow('TWILIO_WHATSAPP_FROM is required in production when OTP_WHATSAPP_ENABLED=true');
    });

    test('Email flags and security flags parse limits and production validation', () => {
        process.env.NODE_ENV = 'production';
        process.env.ORDER_EMAILS_ENABLED = 'true';
        process.env.ORDER_EMAIL_PROVIDER = 'gmail';
        process.env.GMAIL_USER = 'sender@example.com';
        process.env.GMAIL_APP_PASSWORD = 'app-password';
        process.env.ORDER_EMAIL_FROM_ADDRESS = 'sender@example.com';
        process.env.ORDER_EMAIL_REPLY_TO = 'reply@example.com';
        process.env.ORDER_EMAIL_ALERT_TO = '';
        process.env.EMAIL_SECURITY_ALLOWED_EVENT_TYPES = 'otp_security,order_placed,custom_event';
        process.env.EMAIL_SECURITY_MAX_SUBJECT_LEN = '999';
        process.env.EMAIL_SECURITY_MAX_TEXT_LEN = '100';
        process.env.EMAIL_SECURITY_MAX_HTML_LEN = '10';

        let emailFlags;
        let securityFlags;
        jest.isolateModules(() => {
            emailFlags = require('../config/emailFlags');
            securityFlags = require('../config/emailSecurityFlags');
        });

        expect(emailFlags.parseBoolean('true')).toBe(true);
        expect(emailFlags.parseBoolean('no', true)).toBe(false);
        expect(() => emailFlags.assertProductionEmailConfig())
            .toThrow('ORDER_EMAIL_ALERT_TO is required in production for terminal email failures');

        expect(securityFlags.parseBoolean('off', true)).toBe(false);
        expect(securityFlags.parseNumber('999', 10, { min: 5, max: 100 })).toBe(100);
        expect(securityFlags.parseNumber('-1', 10, { min: 5, max: 100 })).toBe(5);
        expect(securityFlags.parseCsv('a, b, ,c')).toEqual(['a', 'b', 'c']);
        expect(securityFlags.flags.emailSecurityAllowedEventTypes).toContain('custom_event');
        expect(securityFlags.flags.emailSecurityMaxSubjectLen).toBe(300);
        expect(securityFlags.flags.emailSecurityMaxTextLen).toBe(500);
        expect(securityFlags.flags.emailSecurityMaxHtmlLen).toBe(500);
    });
});
