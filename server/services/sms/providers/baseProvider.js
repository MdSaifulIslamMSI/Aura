class BaseSmsProvider {
    async sendOtpSms() {
        throw new Error('sendOtpSms must be implemented by provider');
    }
}

module.exports = BaseSmsProvider;
