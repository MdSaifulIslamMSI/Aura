const { getPaymentCapabilities } = require('./payments/paymentCapabilities');
const { getPaymentProvider } = require('./payments/providerFactory');
const { resolvePaymentMarketContext } = require('./payments/paymentMarketCatalog');
const {
    ensureMarketAccess,
    getMarketRule,
} = require('./markets/marketCatalog');

const DEFAULT_SHIPPING_OPTIONS = [
    { id: 'standard', label: 'Standard Delivery', etaLabel: '3-5 business days' },
];

const getProviderForCheckoutConfig = async ({ userId, market }) => {
    try {
        return await getPaymentProvider({
            currency: market.currency || market.defaultCurrency || 'INR',
            paymentMethod: 'CARD',
            userId,
        });
    } catch {
        return null;
    }
};

const getAvailablePaymentMethodsForMarket = async ({ market, userId } = {}) => {
    const activeMarket = ensureMarketAccess(market);
    const marketRule = getMarketRule(activeMarket.countryCode);
    const provider = await getProviderForCheckoutConfig({ userId, market: activeMarket });
    const capabilities = await getPaymentCapabilities({ provider, allowFallback: true });

    const methods = (marketRule.paymentMethods || []).filter((method) => {
        if (method === 'COD') {
            return true;
        }

        try {
            resolvePaymentMarketContext({
                paymentMethod: method,
                paymentContext: {
                    market: {
                        countryCode: activeMarket.countryCode,
                        currency: activeMarket.currency,
                    },
                },
                capabilities,
            });
            return true;
        } catch {
            return false;
        }
    });

    return {
        methods,
        capabilities,
    };
};

const getCheckoutConfig = async ({ market, userId } = {}) => {
    const activeMarket = ensureMarketAccess(market);
    const marketRule = getMarketRule(activeMarket.countryCode);
    const { methods, capabilities } = await getAvailablePaymentMethodsForMarket({
        market: activeMarket,
        userId,
    });

    return {
        market: {
            countryCode: activeMarket.countryCode,
            countryName: activeMarket.countryName,
            currency: activeMarket.currency,
            currencyName: activeMarket.currencyName,
            language: activeMarket.language,
            locale: activeMarket.locale,
            direction: activeMarket.direction,
            source: activeMarket.source,
        },
        paymentMethods: methods,
        addressSchema: {
            ...(marketRule.addressSchema || {}),
        },
        taxRules: {
            ...(marketRule.taxRules || {}),
        },
        shippingOptions: Array.isArray(marketRule.shippingOptions) && marketRule.shippingOptions.length > 0
            ? marketRule.shippingOptions
            : DEFAULT_SHIPPING_OPTIONS,
        policy: {
            promotionLabel: marketRule.promotionLabel || '',
            complianceFlags: [...(marketRule.complianceFlags || [])],
            featuredCategories: [...(marketRule.featuredCategories || [])],
            restrictedCategories: [...(marketRule.restrictedCategories || [])],
        },
        capabilities: capabilities?.rails || {},
    };
};

module.exports = {
    getAvailablePaymentMethodsForMarket,
    getCheckoutConfig,
};
