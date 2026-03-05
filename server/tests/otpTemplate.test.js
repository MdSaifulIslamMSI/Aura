const { renderOtpTemplate } = require('../services/email/templates/otpTemplate');
const { buildOtpEmailContext } = require('../services/emailService');

describe('OTP Email Fortress Template', () => {
    test('renders purpose-specific subject and required security sections', () => {
        const context = buildOtpEmailContext({
            purpose: 'login',
            ip: '203.0.113.77',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
            requestTime: '2026-03-01T10:30:00.000Z',
            location: 'Bengaluru, IN',
        });

        const rendered = renderOtpTemplate({
            otp: '123456',
            purpose: 'login',
            context,
            ttlMinutes: 5,
        });

        expect(rendered.subject).toContain('Login Verification');
        expect(rendered.html).toContain('Security Request Context');
        expect(rendered.html).toContain('Aura will never ask for this code');
        expect(rendered.text).toContain('Security code: 123456');
        expect(context.maskedIp).toBe('203.0.x.x');
        expect(context.deviceLabel).toContain('Desktop');
        expect(context.requestTime).toContain('IST');
        expect(context.requestTime).toContain('UTC');
    });

    test('escapes unsafe dynamic values in html output', () => {
        const rendered = renderOtpTemplate({
            otp: '654321',
            purpose: 'forgot-password',
            context: {
                purposeLabel: '<img src=x onerror=alert(1)>',
                requestTime: 'Now',
                maskedIp: '10.0.x.x',
                deviceLabel: 'Desktop - Chrome',
                locationLabel: '<script>alert("xss")</script>',
            },
            ttlMinutes: 5,
        });

        expect(rendered.html).not.toContain('<script>alert("xss")</script>');
        expect(rendered.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});
