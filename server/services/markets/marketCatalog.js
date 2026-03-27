const AppError = require('../../utils/AppError');

const DEFAULT_COUNTRY_CODE = 'US';
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_BASE_CURRENCY = 'INR';
const DEFAULT_SETTLEMENT_CURRENCY = 'INR';

const REGION_NAMES = typeof Intl?.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;
const CURRENCY_NAMES = typeof Intl?.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'currency' })
    : null;

const normalizeCountryCode = (value) => {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : '';
};

const normalizeCurrencyCode = (value) => {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : '';
};

const normalizeLanguageCode = (value) => {
    const code = String(value || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(code) ? code : '';
};

const parseAcceptLanguage = (value = '') => {
    const language = String(value || '')
        .split(',')[0]
        .split('-')[0]
        .trim()
        .toLowerCase();
    return normalizeLanguageCode(language);
};

const getCountryName = (countryCode = '') => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized) return '';
    return REGION_NAMES?.of(normalized) || normalized;
};

const getCurrencyName = (currencyCode = '') => {
    const normalized = normalizeCurrencyCode(currencyCode);
    if (!normalized) return '';
    return CURRENCY_NAMES?.of(normalized) || normalized;
};

const SUPPORTED_LANGUAGES = {
    en: { code: 'en', label: 'English', locale: 'en-US', direction: 'ltr' },
    hi: { code: 'hi', label: 'Hindi', locale: 'hi-IN', direction: 'ltr' },
    es: { code: 'es', label: 'Spanish', locale: 'es-ES', direction: 'ltr' },
    fr: { code: 'fr', label: 'French', locale: 'fr-FR', direction: 'ltr' },
    de: { code: 'de', label: 'German', locale: 'de-DE', direction: 'ltr' },
    ar: { code: 'ar', label: 'Arabic', locale: 'ar-AE', direction: 'rtl' },
    ja: { code: 'ja', label: 'Japanese', locale: 'ja-JP', direction: 'ltr' },
    pt: { code: 'pt', label: 'Portuguese', locale: 'pt-BR', direction: 'ltr' },
    zh: { code: 'zh', label: 'Chinese', locale: 'zh-CN', direction: 'ltr' },
};

const MARKET_RULES = {
    IN: {
        label: 'India',
        regionLabel: 'South Asia',
        currency: 'INR',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'hi'],
        supportedCurrencies: ['INR'],
        paymentMethods: ['COD', 'UPI', 'CARD', 'WALLET', 'NETBANKING'],
        featuredCategories: ['Electronics', 'Mobile', 'Fashion'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'State',
            cityLabel: 'City',
            postalCodeLabel: 'PIN Code',
            postalCodePattern: '^[1-9][0-9]{5}$',
            postalCodeExample: '560001',
            phoneCode: '+91',
        },
        taxRules: {
            mode: 'gst',
            label: 'GST',
            displayLabel: 'GST at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard Delivery', etaLabel: '3-5 business days' },
            { id: 'express', label: 'Express Delivery', etaLabel: '1-2 business days' },
        ],
        complianceFlags: [],
        promotionLabel: 'India Priority Prices',
    },
    US: {
        label: 'United States',
        regionLabel: 'North America',
        currency: 'USD',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'es'],
        supportedCurrencies: ['USD'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Gaming', 'Accessories'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'State',
            cityLabel: 'City',
            postalCodeLabel: 'ZIP Code',
            postalCodePattern: '^[0-9]{5}(?:-[0-9]{4})?$',
            postalCodeExample: '94105',
            phoneCode: '+1',
        },
        taxRules: {
            mode: 'sales_tax',
            label: 'Sales Tax',
            displayLabel: 'Sales tax at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Ground', etaLabel: '3-6 business days' },
            { id: 'express', label: 'Priority', etaLabel: '1-3 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'US Global Card Pricing',
    },
    GB: {
        label: 'United Kingdom',
        regionLabel: 'Europe',
        currency: 'GBP',
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        supportedCurrencies: ['GBP'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Home & Kitchen'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'County',
            cityLabel: 'Town / City',
            postalCodeLabel: 'Postcode',
            postalCodePattern: '^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$',
            postalCodeExample: 'SW1A 1AA',
            phoneCode: '+44',
        },
        taxRules: {
            mode: 'vat',
            label: 'VAT',
            displayLabel: 'VAT at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 business days' },
            { id: 'express', label: 'Next-Day', etaLabel: '1-2 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'UK Card Presentment',
    },
    DE: {
        label: 'Germany',
        regionLabel: 'Europe',
        currency: 'EUR',
        defaultLanguage: 'de',
        supportedLanguages: ['de', 'en'],
        supportedCurrencies: ['EUR'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Home Appliances'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Land',
            administrativeAreaLabel: 'Bundesland',
            cityLabel: 'Stadt',
            postalCodeLabel: 'PLZ',
            postalCodePattern: '^[0-9]{5}$',
            postalCodeExample: '10115',
            phoneCode: '+49',
        },
        taxRules: {
            mode: 'vat',
            label: 'MwSt',
            displayLabel: 'VAT at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 Werktage' },
            { id: 'express', label: 'Express', etaLabel: '1-2 Werktage' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Deutschland Pricing',
    },
    FR: {
        label: 'France',
        regionLabel: 'Europe',
        currency: 'EUR',
        defaultLanguage: 'fr',
        supportedLanguages: ['fr', 'en'],
        supportedCurrencies: ['EUR'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Fashion'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Pays',
            administrativeAreaLabel: 'Region',
            cityLabel: 'Ville',
            postalCodeLabel: 'Code postal',
            postalCodePattern: '^[0-9]{5}$',
            postalCodeExample: '75001',
            phoneCode: '+33',
        },
        taxRules: {
            mode: 'vat',
            label: 'TVA',
            displayLabel: 'TVA at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 jours ouvres' },
            { id: 'express', label: 'Express', etaLabel: '1-2 jours ouvres' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'France Presentment',
    },
    ES: {
        label: 'Spain',
        regionLabel: 'Europe',
        currency: 'EUR',
        defaultLanguage: 'es',
        supportedLanguages: ['es', 'en'],
        supportedCurrencies: ['EUR'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Sports'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Pais',
            administrativeAreaLabel: 'Provincia',
            cityLabel: 'Ciudad',
            postalCodeLabel: 'Codigo postal',
            postalCodePattern: '^[0-9]{5}$',
            postalCodeExample: '28013',
            phoneCode: '+34',
        },
        taxRules: {
            mode: 'vat',
            label: 'IVA',
            displayLabel: 'IVA at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 dias habiles' },
            { id: 'express', label: 'Express', etaLabel: '1-2 dias habiles' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Espana Pricing',
    },
    AE: {
        label: 'United Arab Emirates',
        regionLabel: 'Middle East',
        currency: 'AED',
        defaultLanguage: 'ar',
        supportedLanguages: ['ar', 'en'],
        supportedCurrencies: ['AED'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Luxury'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'Emirate',
            cityLabel: 'City',
            postalCodeLabel: 'PO Box',
            postalCodePattern: '^[A-Za-z0-9 -]{3,10}$',
            postalCodeExample: '00000',
            phoneCode: '+971',
        },
        taxRules: {
            mode: 'vat',
            label: 'VAT',
            displayLabel: 'VAT at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 business days' },
            { id: 'express', label: 'Express', etaLabel: '1-2 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'import_duties_may_apply', 'international_card_required'],
        promotionLabel: 'Gulf Presentment',
    },
    JP: {
        label: 'Japan',
        regionLabel: 'East Asia',
        currency: 'JPY',
        defaultLanguage: 'ja',
        supportedLanguages: ['ja', 'en'],
        supportedCurrencies: ['JPY'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Gaming', 'Cameras'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'Prefecture',
            cityLabel: 'City',
            postalCodeLabel: 'Postal code',
            postalCodePattern: '^[0-9]{3}-?[0-9]{4}$',
            postalCodeExample: '100-0001',
            phoneCode: '+81',
        },
        taxRules: {
            mode: 'consumption_tax',
            label: 'Consumption Tax',
            displayLabel: 'Consumption tax at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 business days' },
            { id: 'express', label: 'Express', etaLabel: '1-2 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Japan Card Presentment',
    },
    BR: {
        label: 'Brazil',
        regionLabel: 'Latin America',
        currency: 'BRL',
        defaultLanguage: 'pt',
        supportedLanguages: ['pt', 'en'],
        supportedCurrencies: ['BRL'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Accessories'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Pais',
            administrativeAreaLabel: 'Estado',
            cityLabel: 'Cidade',
            postalCodeLabel: 'CEP',
            postalCodePattern: '^[0-9]{5}-?[0-9]{3}$',
            postalCodeExample: '01001-000',
            phoneCode: '+55',
        },
        taxRules: {
            mode: 'vat',
            label: 'Impostos',
            displayLabel: 'Taxes at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '4-7 business days' },
            { id: 'express', label: 'Express', etaLabel: '2-4 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'import_duties_may_apply', 'international_card_required'],
        promotionLabel: 'Brasil Presentment',
    },
    CA: {
        label: 'Canada',
        regionLabel: 'North America',
        currency: 'CAD',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'fr'],
        supportedCurrencies: ['CAD'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Outdoor'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'Province',
            cityLabel: 'City',
            postalCodeLabel: 'Postal code',
            postalCodePattern: '^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$',
            postalCodeExample: 'M5V 2T6',
            phoneCode: '+1',
        },
        taxRules: {
            mode: 'sales_tax',
            label: 'Sales Tax',
            displayLabel: 'Tax at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Ground', etaLabel: '3-6 business days' },
            { id: 'express', label: 'Priority', etaLabel: '1-3 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Canada Pricing',
    },
    AU: {
        label: 'Australia',
        regionLabel: 'Oceania',
        currency: 'AUD',
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        supportedCurrencies: ['AUD'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Outdoor'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'State / Territory',
            cityLabel: 'Suburb / City',
            postalCodeLabel: 'Postcode',
            postalCodePattern: '^[0-9]{4}$',
            postalCodeExample: '2000',
            phoneCode: '+61',
        },
        taxRules: {
            mode: 'gst',
            label: 'GST',
            displayLabel: 'GST at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '3-6 business days' },
            { id: 'express', label: 'Express', etaLabel: '1-3 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Australia Pricing',
    },
    MX: {
        label: 'Mexico',
        regionLabel: 'North America',
        currency: 'MXN',
        defaultLanguage: 'es',
        supportedLanguages: ['es', 'en'],
        supportedCurrencies: ['MXN'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Lifestyle'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Pais',
            administrativeAreaLabel: 'Estado',
            cityLabel: 'Ciudad',
            postalCodeLabel: 'Codigo postal',
            postalCodePattern: '^[0-9]{5}$',
            postalCodeExample: '01000',
            phoneCode: '+52',
        },
        taxRules: {
            mode: 'vat',
            label: 'IVA',
            displayLabel: 'IVA at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '4-7 business days' },
            { id: 'express', label: 'Express', etaLabel: '2-4 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'international_card_required'],
        promotionLabel: 'Mexico Presentment',
    },
    CN: {
        label: 'China',
        regionLabel: 'East Asia',
        currency: 'CNY',
        defaultLanguage: 'zh',
        supportedLanguages: ['zh', 'en'],
        supportedCurrencies: ['CNY'],
        paymentMethods: ['CARD'],
        featuredCategories: ['Electronics', 'Mobile'],
        restrictedCategories: [],
        restrictedProductIds: [],
        addressSchema: {
            countryLabel: 'Country',
            administrativeAreaLabel: 'Province',
            cityLabel: 'City',
            postalCodeLabel: 'Postal code',
            postalCodePattern: '^[0-9]{6}$',
            postalCodeExample: '100000',
            phoneCode: '+86',
        },
        taxRules: {
            mode: 'vat',
            label: 'VAT',
            displayLabel: 'VAT at checkout',
        },
        shippingOptions: [
            { id: 'standard', label: 'Standard', etaLabel: '4-7 business days' },
            { id: 'express', label: 'Express', etaLabel: '2-4 business days' },
        ],
        complianceFlags: ['cross_border_customs_review', 'import_duties_may_apply', 'international_card_required'],
        promotionLabel: 'China Card Presentment',
    },
};

const DEFAULT_MARKET_RULE = MARKET_RULES[DEFAULT_COUNTRY_CODE];

const getLanguageConfig = (languageCode = DEFAULT_LANGUAGE_CODE) => (
    SUPPORTED_LANGUAGES[normalizeLanguageCode(languageCode)] || SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE_CODE]
);

const getMarketRule = (countryCode = DEFAULT_COUNTRY_CODE) => (
    MARKET_RULES[normalizeCountryCode(countryCode)] || DEFAULT_MARKET_RULE
);

const resolveLocale = ({ marketRule, languageCode, countryCode }) => {
    const language = getLanguageConfig(languageCode);
    if (language.code === marketRule.defaultLanguage) {
        return `${language.code}-${countryCode}`;
    }
    return language.locale;
};

const getMarketPolicySummary = (marketRule = DEFAULT_MARKET_RULE) => ({
    featuredCategories: [...(marketRule.featuredCategories || [])],
    restrictedCategories: [...(marketRule.restrictedCategories || [])],
    restrictedProductIds: [...(marketRule.restrictedProductIds || [])],
    paymentMethods: [...(marketRule.paymentMethods || [])],
    complianceFlags: [...(marketRule.complianceFlags || [])],
    promotionLabel: marketRule.promotionLabel || '',
});

const resolveMarketContext = ({
    country,
    currency,
    language,
    acceptLanguage,
    source = 'default',
} = {}) => {
    const requestedCountryCode = normalizeCountryCode(country) || DEFAULT_COUNTRY_CODE;
    const marketRule = getMarketRule(requestedCountryCode);
    const countryCode = Object.entries(MARKET_RULES).find(([, rule]) => rule === marketRule)?.[0] || DEFAULT_COUNTRY_CODE;
    const requestedCurrency = normalizeCurrencyCode(currency);
    const requestedLanguage = normalizeLanguageCode(language) || parseAcceptLanguage(acceptLanguage) || '';

    const languageCode = marketRule.supportedLanguages.includes(requestedLanguage)
        ? requestedLanguage
        : (marketRule.supportedLanguages[0] || marketRule.defaultLanguage || DEFAULT_LANGUAGE_CODE);
    const finalCurrency = marketRule.supportedCurrencies.includes(requestedCurrency)
        ? requestedCurrency
        : (requestedCurrency || marketRule.currency || DEFAULT_CURRENCY);
    const locale = resolveLocale({ marketRule, languageCode, countryCode });

    return {
        source,
        countryCode,
        countryName: getCountryName(countryCode) || marketRule.label || countryCode,
        regionLabel: marketRule.regionLabel || '',
        language: languageCode,
        languageLabel: getLanguageConfig(languageCode).label,
        direction: getLanguageConfig(languageCode).direction,
        locale,
        currency: finalCurrency,
        currencyName: getCurrencyName(finalCurrency) || finalCurrency,
        defaultCurrency: marketRule.currency || DEFAULT_CURRENCY,
        baseCurrency: DEFAULT_BASE_CURRENCY,
        settlementCurrency: DEFAULT_SETTLEMENT_CURRENCY,
        paymentMethods: [...(marketRule.paymentMethods || [])],
        featuredCategories: [...(marketRule.featuredCategories || [])],
        restrictedCategories: [...(marketRule.restrictedCategories || [])],
        restrictedProductIds: [...(marketRule.restrictedProductIds || [])],
        promotionLabel: marketRule.promotionLabel || '',
        complianceFlags: [...(marketRule.complianceFlags || [])],
        addressSchema: { ...(marketRule.addressSchema || {}) },
        taxRules: { ...(marketRule.taxRules || {}) },
        shippingOptions: [...(marketRule.shippingOptions || [])],
        fallbackBehavior: {
            currencyFallbackApplied: Boolean(requestedCurrency && !marketRule.supportedCurrencies.includes(requestedCurrency)),
            languageFallbackApplied: Boolean(requestedLanguage && !marketRule.supportedLanguages.includes(requestedLanguage)),
        },
    };
};

const ensureMarketAccess = (market = null) => {
    if (!market || !market.countryCode) {
        throw new AppError('Market context is not available', 500);
    }
    return market;
};

const isProductRestrictedForMarket = (product = {}, market = null) => {
    const activeMarket = ensureMarketAccess(market);
    const productId = Number(product?.id || 0);
    const category = String(product?.category || '').trim();
    return activeMarket.restrictedProductIds.includes(productId)
        || activeMarket.restrictedCategories.includes(category);
};

const buildComplianceFlagsForProduct = (product = {}, market = null) => {
    const activeMarket = ensureMarketAccess(market);
    const flags = new Set(activeMarket.complianceFlags || []);
    if (isProductRestrictedForMarket(product, activeMarket)) {
        flags.add('restricted_in_market');
    }
    return Array.from(flags);
};

const buildCatalogMarketMetadata = ({ product, market }) => {
    const activeMarket = ensureMarketAccess(market);
    const category = String(product?.category || '').trim();
    return {
        visible: !isProductRestrictedForMarket(product, activeMarket),
        featured: activeMarket.featuredCategories.includes(category),
        promotionLabel: activeMarket.promotionLabel || '',
        complianceFlags: buildComplianceFlagsForProduct(product, activeMarket),
    };
};

module.exports = {
    DEFAULT_COUNTRY_CODE,
    DEFAULT_LANGUAGE_CODE,
    DEFAULT_CURRENCY,
    DEFAULT_BASE_CURRENCY,
    DEFAULT_SETTLEMENT_CURRENCY,
    SUPPORTED_LANGUAGES,
    MARKET_RULES,
    normalizeCountryCode,
    normalizeCurrencyCode,
    normalizeLanguageCode,
    parseAcceptLanguage,
    getCountryName,
    getCurrencyName,
    getLanguageConfig,
    getMarketRule,
    getMarketPolicySummary,
    resolveMarketContext,
    ensureMarketAccess,
    isProductRestrictedForMarket,
    buildComplianceFlagsForProduct,
    buildCatalogMarketMetadata,
};
