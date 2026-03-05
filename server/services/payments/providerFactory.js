const RazorpayProvider = require('./providers/razorpayProvider');
const SimulatedProvider = require('./providers/simulatedProvider');
const { flags } = require('../../config/paymentFlags');

let cachedProvider = null;

const createProvider = () => {
    if (flags.paymentProvider === 'razorpay') {
        return new RazorpayProvider({
            keyId: process.env.RAZORPAY_KEY_ID,
            keySecret: process.env.RAZORPAY_KEY_SECRET,
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
        });
    }
    return new SimulatedProvider();
};

const getPaymentProvider = () => {
    if (!cachedProvider) {
        cachedProvider = createProvider();
    }
    return cachedProvider;
};

module.exports = {
    getPaymentProvider,
};

