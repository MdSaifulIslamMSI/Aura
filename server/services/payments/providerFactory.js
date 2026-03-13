const RazorpayProvider = require('./providers/razorpayProvider');
const SimulatedProvider = require('./providers/simulatedProvider');
const { flags } = require('../../config/paymentFlags');
const { calculateOptimalRoute } = require('./paymentRouter');

const providers = new Map();

const getInternalProvider = (gatewayId) => {
    if (providers.has(gatewayId)) return providers.get(gatewayId);

    let provider;
    if (gatewayId === 'razorpay') {
        provider = new RazorpayProvider({
            keyId: process.env.RAZORPAY_KEY_ID,
            keySecret: process.env.RAZORPAY_KEY_SECRET,
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
        });
    } else {
        provider = new SimulatedProvider();
    }

    providers.set(gatewayId, provider);
    return provider;
};

const getPaymentProvider = async (context = {}) => {
    // If explicit routing is disabled, follow the static flag
    if (!flags.paymentDynamicRoutingEnabled) {
        return getInternalProvider(flags.paymentProvider);
    }

    // Solve for the optimal route
    const route = await calculateOptimalRoute(context);
    const provider = getInternalProvider(route.gatewayId);
    
    // Attach route insights to provider for the current request context
    // Note: This is an ephemeral enrichment for the caller
    // Create an ephemeral clone that preserves the instance prototype
    const instance = Object.create(Object.getPrototypeOf(provider));
    Object.assign(instance, provider, { routingInsights: route });
    return instance;
};

module.exports = {
    getPaymentProvider,
};

