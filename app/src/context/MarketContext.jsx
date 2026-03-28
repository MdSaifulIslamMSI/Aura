import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSE_BASE_CURRENCY,
  DEFAULT_MARKET_PREFERENCE,
  MARKET_PRESENTMENT_RATES,
  MARKET_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MARKETS,
  detectMarketPreference,
  formatMessageTemplate,
  getMessageTemplate,
  getCountryDisplayName,
  getCurrencyDisplayName,
  getSupportedLanguage,
  getSupportedMarket,
  normalizeMarketPreference,
  resolveLocaleForSelection,
} from '@/config/marketConfig';
import { i18nApi } from '@/services/api/i18nApi';
import {
  formatDateTime as formatDateTimeUtil,
  formatNumber as formatNumberUtil,
  formatPrice as formatPriceUtil,
  setMarketFormatDefaults,
} from '@/utils/format';
import { marketApi, readCachedBrowseFxRates } from '@/services/api/marketApi';
import { setActiveMarketHeaders } from '@/services/marketRuntime';

const MarketContext = createContext(null);
const LIVE_BROWSE_FX_REFRESH_MS = 30 * 60 * 1000;

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

const getRuntimeTranslationCacheKey = (languageCode, text) => `${String(languageCode || '').trim().toLowerCase()}::${String(text || '')}`;

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
  const [browseFxState, setBrowseFxState] = useState(() => {
    const cachedPayload = readCachedBrowseFxRates(BROWSE_BASE_CURRENCY);
    return {
      rates: {
        ...MARKET_PRESENTMENT_RATES,
        ...(cachedPayload?.rates || {}),
        [BROWSE_BASE_CURRENCY]: 1,
      },
      meta: cachedPayload
        ? {
            source: cachedPayload.source || '',
            provider: cachedPayload.provider || '',
            fetchedAt: cachedPayload.fetchedAt || '',
            asOfDate: cachedPayload.asOfDate || '',
            stale: Boolean(cachedPayload.stale),
            staleReason: cachedPayload.staleReason || '',
          }
        : null,
    };
  });

  useEffect(() => {
    setPreference((currentPreference) => currentPreference || detectedPreference);
  }, [detectedPreference]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;
    let activeController = null;

    const applyBrowseFxPayload = (payload = null) => {
      if (!payload?.rates || cancelled) {
        return;
      }

      setBrowseFxState((currentState) => {
        const nextRates = {
          ...MARKET_PRESENTMENT_RATES,
          ...currentState.rates,
          ...payload.rates,
          [BROWSE_BASE_CURRENCY]: 1,
        };

        const currentKeys = Object.keys(currentState.rates || {});
        const nextKeys = Object.keys(nextRates);
        const ratesChanged = currentKeys.length !== nextKeys.length
          || nextKeys.some((key) => currentState.rates?.[key] !== nextRates[key]);
        const nextMeta = {
          source: payload.source || '',
          provider: payload.provider || '',
          fetchedAt: payload.fetchedAt || '',
          asOfDate: payload.asOfDate || '',
          stale: Boolean(payload.stale),
          staleReason: payload.staleReason || '',
        };
        const metaChanged = JSON.stringify(currentState.meta || {}) !== JSON.stringify(nextMeta);

        if (!ratesChanged && !metaChanged) {
          return currentState;
        }

        return {
          rates: nextRates,
          meta: nextMeta,
        };
      });
    };

    const refreshBrowseFxRates = async () => {
      activeController?.abort();
      activeController = new AbortController();

      try {
        const payload = await marketApi.getBrowseFxRates({
          baseCurrency: BROWSE_BASE_CURRENCY,
          signal: activeController.signal,
        });
        applyBrowseFxPayload(payload);
      } catch {
        // Keep the fallback browse rates when live FX refresh fails.
      }
    };

    applyBrowseFxPayload(readCachedBrowseFxRates(BROWSE_BASE_CURRENCY));
    void refreshBrowseFxRates();

    const intervalId = window.setInterval(() => {
      void refreshBrowseFxRates();
    }, LIVE_BROWSE_FX_REFRESH_MS);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  const market = useMemo(() => getSupportedMarket(preference.countryCode), [preference.countryCode]);
  const language = useMemo(() => getSupportedLanguage(preference.language), [preference.language]);
  const locale = useMemo(
    () => resolveLocaleForSelection(language.code, market.countryCode),
    [language.code, market.countryCode]
  );
  const direction = language.direction || 'ltr';
  const isEstimatedPricing = preference.currency !== BROWSE_BASE_CURRENCY;
  const runtimeTranslationsRef = useRef(new Map());
  const runtimeTranslationRequestsRef = useRef(new Set());
  const runtimeTranslationsInFlightRef = useRef(new Set());
  const [runtimeTranslationVersion, setRuntimeTranslationVersion] = useState(0);

  useEffect(() => {
    const nextPreference = {
      ...preference,
      locale,
    };

    setMarketFormatDefaults({
      currency: nextPreference.currency,
      locale: nextPreference.locale,
      baseCurrency: BROWSE_BASE_CURRENCY,
      rates: browseFxState.rates,
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
  }, [browseFxState.rates, direction, locale, preference]);

  useEffect(() => {
    if (language.code === 'en') {
      runtimeTranslationRequestsRef.current.clear();
      return;
    }

    const pendingTexts = [...runtimeTranslationRequestsRef.current].filter((text) => {
      const cacheKey = getRuntimeTranslationCacheKey(language.code, text);
      return !runtimeTranslationsRef.current.has(cacheKey) && !runtimeTranslationsInFlightRef.current.has(cacheKey);
    });

    runtimeTranslationRequestsRef.current.clear();

    if (pendingTexts.length === 0) {
      return;
    }

    pendingTexts.forEach((text) => {
      runtimeTranslationsInFlightRef.current.add(getRuntimeTranslationCacheKey(language.code, text));
    });

    void i18nApi.translateTexts({
      texts: pendingTexts,
      language: language.code,
      sourceLanguage: 'en',
    })
      .then((translations) => {
        let didChange = false;

        pendingTexts.forEach((text) => {
          const cacheKey = getRuntimeTranslationCacheKey(language.code, text);
          runtimeTranslationsInFlightRef.current.delete(cacheKey);

          const translated = String(translations?.[text] || text);
          if (runtimeTranslationsRef.current.get(cacheKey) !== translated) {
            runtimeTranslationsRef.current.set(cacheKey, translated);
            didChange = true;
          }
        });

        if (didChange) {
          setRuntimeTranslationVersion((version) => version + 1);
        }
      })
      .catch(() => {
        pendingTexts.forEach((text) => {
          const cacheKey = getRuntimeTranslationCacheKey(language.code, text);
          runtimeTranslationsInFlightRef.current.delete(cacheKey);
          if (!runtimeTranslationsRef.current.has(cacheKey)) {
            runtimeTranslationsRef.current.set(cacheKey, text);
          }
        });
      });
  });

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

  const translateMessage = useMemo(() => (
    (key, values = {}, fallback = '') => {
      const localizedTemplate = getMessageTemplate(language.code, key);
      if (localizedTemplate) {
        return formatMessageTemplate(localizedTemplate, values);
      }

      const englishTemplate = getMessageTemplate('en', key);
      const fallbackTemplate = fallback || key;
      const template = englishTemplate || fallbackTemplate;
      const englishText = formatMessageTemplate(template, values);
      const hasInterpolationValues = Object.values(values || {}).some((value) => (
        value !== undefined && value !== null && String(value) !== ''
      ));
      const translationTemplate = englishTemplate || (!hasInterpolationValues ? fallbackTemplate : '');

      if (language.code === 'en') {
        return englishText;
      }

      // Only queue stable catalog templates for runtime translation.
      // Interpolated fallback strings such as timestamps, IDs, and counts
      // would otherwise create a fresh translation job on every render.
      if (!translationTemplate) {
        return englishText;
      }

      const cacheKey = getRuntimeTranslationCacheKey(language.code, translationTemplate);
      const translatedTemplate = runtimeTranslationsRef.current.get(cacheKey);
      if (translatedTemplate) {
        return formatMessageTemplate(translatedTemplate, values);
      }

      if (runtimeTranslationsInFlightRef.current.has(cacheKey)) {
        return englishText;
      }

      runtimeTranslationRequestsRef.current.add(translationTemplate);
      return englishText;
    }
  ), [language.code, runtimeTranslationVersion]);

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
      browseFxMeta: browseFxState.meta,
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
      t: translateMessage,
      formatPrice: (value, currency, customLocale, options = {}) => formatPriceUtil(
        value,
        currency,
        customLocale || locale,
        {
          ...options,
          baseCurrency: options.baseCurrency || BROWSE_BASE_CURRENCY,
          presentmentCurrency: options.presentmentCurrency || preference.currency,
          rates: options.rates || browseFxState.rates,
        }
      ),
      formatNumber: (value, customLocale, options) => formatNumberUtil(value, customLocale || locale, options),
      formatDateTime: (value, customLocale, options) => formatDateTimeUtil(value, customLocale || locale, options),
      browseCurrencyNote: translateMessage(
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
    browseFxState,
    translateMessage,
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
