const defaultMarketState = {
  country: 'IN',
  currency: 'INR',
  language: 'en',
};

let activeMarketState = { ...defaultMarketState };

const normalizeCountry = (value) => String(value || defaultMarketState.country).trim().toUpperCase().slice(0, 2) || defaultMarketState.country;
const normalizeCurrency = (value) => String(value || defaultMarketState.currency).trim().toUpperCase().slice(0, 3) || defaultMarketState.currency;
const normalizeLanguage = (value) => String(value || defaultMarketState.language).trim().toLowerCase().slice(0, 5) || defaultMarketState.language;

export const setActiveMarketHeaders = (market = {}) => {
  activeMarketState = {
    country: normalizeCountry(market.country || market.countryCode),
    currency: normalizeCurrency(market.currency),
    language: normalizeLanguage(market.language),
  };
};

export const getActiveMarketHeaders = () => ({
  'x-market-country': activeMarketState.country,
  'x-market-currency': activeMarketState.currency,
  'x-market-language': activeMarketState.language,
});

export const getActiveMarketState = () => ({ ...activeMarketState });

export const resetActiveMarketHeaders = () => {
  activeMarketState = { ...defaultMarketState };
};
