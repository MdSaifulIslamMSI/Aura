const RazorpayProvider = require('./providers/razorpayProvider');
const AppError = require('../../utils/AppError');
const { flags } = require('../../config/paymentFlags');
const { calculateOptimalRoute } = require('./paymentRouter');

const providers = new Map();
const SUPPORTED_GATEWAYS = new Set(['razorpay']);

const getInternalProvider = (gatewayId) => {
    const normalizedGatewayId = String(gatewayId || '').trim().toLowerCase();
    if (!SUPPORTED_GATEWAYS.has(normalizedGatewayId)) {
        throw new AppError(`Unsupported payment gateway route: ${normalizedGatewayId || 'unknown'}`, 503);
    }

    if (providers.has(normalizedGatewayId)) return providers.get(normalizedGatewayId);

    let provider;
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay credentials are not configured on the server', 503);
    }
    provider = new RazorpayProvider({
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });

    providers.set(normalizedGatewayId, provider);
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

