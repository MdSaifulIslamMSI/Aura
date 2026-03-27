import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  BROWSE_BASE_CURRENCY,
  DEFAULT_MARKET_PREFERENCE,
  MARKET_PRESENTMENT_RATES,
  MARKET_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MARKETS,
  createTranslator,
  detectMarketPreference,
  getCountryDisplayName,
  getCurrencyDisplayName,
  getSupportedLanguage,
  getSupportedMarket,
  normalizeMarketPreference,
  resolveLocaleForSelection,
} from '@/config/marketConfig';
import {
  formatDateTime as formatDateTimeUtil,
  formatNumber as formatNumberUtil,
  formatPrice as formatPriceUtil,
  setMarketFormatDefaults,
} from '@/utils/format';
import { setActiveMarketHeaders } from '@/services/marketRuntime';

const MarketContext = createContext(null);

const readStoredPreference = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(MARKET_STORAGE_KEY);
    if (!rawValue) return null;
    return normalizeMarketPreference(JSON.parse(rawValue));
  } catch {
    return null;
  }
};

const buildCountryOptions = (locale) => SUPPORTED_MARKETS.map((market) => ({
  value: market.countryCode,
  label: getCountryDisplayName(market.countryCode, locale),
  regionLabel: market.regionLabel,
  currency: market.currency,
}));

const buildCurrencyOptions = (locale) => (
  [...new Set(SUPPORTED_MARKETS.map((market) => market.currency))]
    .map((currency) => ({
      value: currency,
      label: `${currency} - ${getCurrencyDisplayName(currency, locale)}`,
    }))
);

const buildLanguageOptions = (languageCode) => SUPPORTED_LANGUAGES.map((language) => ({
  value: language.code,
  label: language.label,
  nativeLabel: language.nativeLabel,
  direction: language.direction,
  activeLocale: resolveLocaleForSelection(language.code, languageCode),
}));

export function MarketProvider({
  children,
  initialPreference = null,
  disableBrowserDetection = false,
}) {
  const detectedPreference = useMemo(() => {
    if (initialPreference) {
      return normalizeMarketPreference(initialPreference);
    }
    if (disableBrowserDetection) {
      return DEFAULT_MARKET_PREFERENCE;
    }
    return detectMarketPreference();
  }, [disableBrowserDetection, initialPreference]);

  const [preference, setPreference] = useState(() => readStoredPreference() || detectedPreference);

  useEffect(() => {
    setPreference((currentPreference) => currentPreference || detectedPreference);
  }, [detectedPreference]);

  const market = useMemo(() => getSupportedMarket(preference.countryCode), [preference.countryCode]);
  const language = useMemo(() => getSupportedLanguage(preference.language), [preference.language]);
  const locale = useMemo(
    () => resolveLocaleForSelection(language.code, market.countryCode),
    [language.code, market.countryCode]
  );
  const direction = language.direction || 'ltr';
  const translator = useMemo(() => createTranslator(language.code), [language.code]);
  const isEstimatedPricing = preference.currency !== BROWSE_BASE_CURRENCY;

  useEffect(() => {
    const nextPreference = {
      ...preference,
      locale,
    };

    setMarketFormatDefaults({
      currency: nextPreference.currency,
      locale: nextPreference.locale,
      baseCurrency: BROWSE_BASE_CURRENCY,
      rates: MARKET_PRESENTMENT_RATES,
    });
    setActiveMarketHeaders({
      country: nextPreference.countryCode,
      currency: nextPreference.currency,
      language: nextPreference.language,
    });

    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextPreference.locale;
      document.documentElement.dir = direction;
      document.documentElement.setAttribute('data-market-country', nextPreference.countryCode);
      document.documentElement.setAttribute('data-market-currency', nextPreference.currency);
      document.documentElement.setAttribute('data-market-language', nextPreference.language);
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(nextPreference));
    }
  }, [direction, locale, preference]);

  const setCountryCode = (countryCode) => {
    setPreference((currentPreference) => normalizeMarketPreference({
      ...currentPreference,
      countryCode,
    }));
  };

  const setLanguage = (languageCode) => {
    setPreference((currentPreference) => normalizeMarketPreference({
      ...currentPreference,
      language: languageCode,
    }));
  };

  const setCurrency = (currencyCode) => {
    setPreference((currentPreference) => normalizeMarketPreference({
      ...currentPreference,
      currency: currencyCode,
    }));
  };

  const resetToDetected = () => {
    setPreference(normalizeMarketPreference(detectedPreference));
  };

  const value = useMemo(() => {
    const detectedMarket = getSupportedMarket(detectedPreference.countryCode);

    return {
      ...preference,
      locale,
      direction,
      market,
      languageCode: preference.language,
      languageConfig: language,
      regionLabel: market.regionLabel,
      countryLabel: getCountryDisplayName(market.countryCode, locale),
      currencyLabel: getCurrencyDisplayName(preference.currency, locale),
      voiceLocale: locale,
      isEstimatedPricing,
      detectedPreference: normalizeMarketPreference(detectedPreference),
      detectedRegionLabel: detectedMarket.regionLabel,
      detectedCountryLabel: getCountryDisplayName(detectedMarket.countryCode, locale),
      countryOptions: buildCountryOptions(locale),
      currencyOptions: buildCurrencyOptions(locale),
      languageOptions: buildLanguageOptions(market.countryCode),
      setCountryCode,
      setLanguage,
      setCurrency,
      resetToDetected,
      t: (key, values = {}, fallback = '') => translator(key, values, fallback),
      formatPrice: (value, currency, customLocale, options = {}) => formatPriceUtil(
        value,
        currency,
        customLocale || locale,
        {
          ...options,
          baseCurrency: options.baseCurrency || BROWSE_BASE_CURRENCY,
          presentmentCurrency: options.presentmentCurrency || preference.currency,
          rates: options.rates || MARKET_PRESENTMENT_RATES,
        }
      ),
      formatNumber: (value, customLocale, options) => formatNumberUtil(value, customLocale || locale, options),
      formatDateTime: (value, customLocale, options) => formatDateTimeUtil(value, customLocale || locale, options),
      browseCurrencyNote: translator(
        isEstimatedPricing ? 'market.estimated' : 'market.exact',
        {},
        isEstimatedPricing ? 'Estimated browse FX' : 'Native catalog FX'
      ),
    };
  }, [
    detectedPreference,
    direction,
    isEstimatedPricing,
    language,
    locale,
    market,
    preference,
    translator,
  ]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used inside MarketProvider');
  }
  return context;
}
