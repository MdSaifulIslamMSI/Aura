const BaseSmsProvider = require('./baseProvider');

class MockSmsProvider extends BaseSmsProvider {
    async sendOtpSms({ toPhone, body, channel = 'sms' }) {
        return {
            provider: 'mock',
            channel: channel === 'whatsapp' ? 'whatsapp' : 'sms',
            providerMessageId: `mock-sms-${Date.now()}`,
            response: {
                accepted: true,
                toPhone,
                length: String(body || '').length,
            },
        };
    }
}

module.exports = MockSmsProvider;
