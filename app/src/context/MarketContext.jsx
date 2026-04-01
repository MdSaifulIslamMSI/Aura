import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSE_BASE_CURRENCY,
  DEFAULT_MARKET_PREFERENCE,
  MARKET_PRESENTMENT_RATES,
  MARKET_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MARKETS,
  detectMarketPreference,
  ensureMarketMessagesLoaded,
  formatMessageTemplate,
  getMessageTemplate,
  getCountryDisplayName,
  getCurrencyDisplayName,
  hasLoadedMarketMessagePack,
  getSupportedLanguage,
  getSupportedMarket,
  normalizeMarketPreference,
  resolveLocaleForSelection,
} from '@/config/marketConfig';
import {
  getCachedRuntimeTranslation,
  hydrateRuntimeTranslations,
  requestRuntimeTranslations,
} from '@/services/runtimeTranslation';
import {
  formatDateTime as formatDateTimeUtil,
  formatNumber as formatNumberUtil,
  formatPrice as formatPriceUtil,
  setMarketFormatDefaults,
} from '@/utils/format';
import { marketApi, readCachedBrowseFxRates } from '@/services/api/marketApi';
import { setActiveMarketHeaders } from '@/services/marketRuntime';

const MarketContext = createContext(null);
const DEFAULT_LIVE_BROWSE_FX_REFRESH_MS = 60 * 1000;
const MIN_LIVE_BROWSE_FX_REFRESH_MS = 1000;
const MAX_LIVE_BROWSE_FX_REFRESH_MS = 60 * 1000;

const getLiveBrowseFxRefreshMs = (cacheTtlMs = DEFAULT_LIVE_BROWSE_FX_REFRESH_MS) => {
  const numericValue = Number(cacheTtlMs);
  if (!Number.isFinite(numericValue) || numericValue < MIN_LIVE_BROWSE_FX_REFRESH_MS) {
    return DEFAULT_LIVE_BROWSE_FX_REFRESH_MS;
  }
  return Math.max(MIN_LIVE_BROWSE_FX_REFRESH_MS, Math.min(numericValue, MAX_LIVE_BROWSE_FX_REFRESH_MS));
};

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
            cacheTtlMs: Number(cachedPayload.cacheTtlMs || 0),
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
    let refreshTimeoutId = 0;
    let refreshIdleId = 0;

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
          cacheTtlMs: Number(payload.cacheTtlMs || 0),
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
          revalidate: true,
        });
        applyBrowseFxPayload(payload);
      } catch {
        // Keep the fallback browse rates when live FX refresh fails.
      }
    };

    const handleForegroundRefresh = () => {
      if (cancelled) {
        return;
      }

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      void refreshBrowseFxRates();
    };

    applyBrowseFxPayload(readCachedBrowseFxRates(BROWSE_BASE_CURRENCY));
    refreshTimeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        refreshIdleId = window.requestIdleCallback(() => {
          void refreshBrowseFxRates();
        }, { timeout: 1500 });
        return;
      }

      void refreshBrowseFxRates();
    }, 250);

    const intervalId = window.setInterval(() => {
      void refreshBrowseFxRates();
    }, getLiveBrowseFxRefreshMs(browseFxState.meta?.cacheTtlMs));

    window.addEventListener('focus', handleForegroundRefresh);
    window.addEventListener('online', handleForegroundRefresh);
    document.addEventListener('visibilitychange', handleForegroundRefresh);

    return () => {
      cancelled = true;
      activeController?.abort();
      if (refreshTimeoutId) {
        window.clearTimeout(refreshTimeoutId);
      }
      if (refreshIdleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(refreshIdleId);
      }
      window.removeEventListener('focus', handleForegroundRefresh);
      window.removeEventListener('online', handleForegroundRefresh);
      document.removeEventListener('visibilitychange', handleForegroundRefresh);
      window.clearInterval(intervalId);
    };
  }, [browseFxState.meta?.cacheTtlMs]);

  const market = useMemo(() => getSupportedMarket(preference.countryCode), [preference.countryCode]);
  const language = useMemo(() => getSupportedLanguage(preference.language), [preference.language]);
  const locale = useMemo(
    () => resolveLocaleForSelection(language.code, market.countryCode),
    [language.code, market.countryCode]
  );
  const direction = language.direction || 'ltr';
  const isEstimatedPricing = preference.currency !== BROWSE_BASE_CURRENCY;
  const runtimeTranslationRequestsRef = useRef(new Set());
  const runtimeTranslationPendingRef = useRef(new Set());
  const runtimeTranslationFlushScheduledRef = useRef(false);
  const runtimeTranslationMountedRef = useRef(true);
  const runtimeTranslationQueuedKeyRef = useRef('');
  const [marketMessageVersion, setMarketMessageVersion] = useState(0);
  const [runtimeTranslationVersion, setRuntimeTranslationVersion] = useState(0);
  const [runtimeTranslationRequestSignal, setRuntimeTranslationRequestSignal] = useState(0);

  const nextPreference = useMemo(() => ({
    ...preference,
    locale,
  }), [locale, preference]);

  // Prime global market helpers before children render so direct formatters
  // and API effects see the selected market on the very first paint.
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
  hydrateRuntimeTranslations(language.code);

  useEffect(() => {
    runtimeTranslationMountedRef.current = true;
    return () => {
      runtimeTranslationMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void ensureMarketMessagesLoaded(language.code).then((didLoad) => {
      if (!cancelled && didLoad) {
        setMarketMessageVersion((version) => version + 1);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [language.code]);

  useEffect(() => {
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

  const scheduleRuntimeTranslationFlush = useCallback(() => {
    if (runtimeTranslationFlushScheduledRef.current) {
      return;
    }

    runtimeTranslationFlushScheduledRef.current = true;
    const schedule = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);

    schedule(() => {
      runtimeTranslationFlushScheduledRef.current = false;
      if (!runtimeTranslationMountedRef.current) {
        return;
      }
      setRuntimeTranslationRequestSignal((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    if (language.code === 'en') {
      runtimeTranslationQueuedKeyRef.current = '';
      return;
    }

    const queuedTexts = [...runtimeTranslationRequestsRef.current];
    if (queuedTexts.length === 0) {
      runtimeTranslationQueuedKeyRef.current = '';
      return;
    }

    const queuedKey = queuedTexts.join('\u0000');
    if (queuedKey === runtimeTranslationQueuedKeyRef.current) {
      return;
    }

    runtimeTranslationQueuedKeyRef.current = queuedKey;
    scheduleRuntimeTranslationFlush();
  });

  useEffect(() => {
    if (language.code === 'en') {
      runtimeTranslationRequestsRef.current.clear();
      runtimeTranslationPendingRef.current.clear();
      runtimeTranslationQueuedKeyRef.current = '';
      return;
    }

    const pendingTexts = [...runtimeTranslationRequestsRef.current].filter((text) => {
      return !runtimeTranslationPendingRef.current.has(text) && !getCachedRuntimeTranslation({
        language: language.code,
        text,
      });
    });

    runtimeTranslationRequestsRef.current.clear();
    runtimeTranslationQueuedKeyRef.current = '';

    if (pendingTexts.length === 0) {
      return;
    }

    pendingTexts.forEach((text) => {
      runtimeTranslationPendingRef.current.add(text);
    });

    void requestRuntimeTranslations({
      texts: pendingTexts,
      language: language.code,
      sourceLanguage: 'en',
    })
      .then(() => {
        let shouldRerender = false;
        pendingTexts.forEach((text) => {
          runtimeTranslationPendingRef.current.delete(text);
          shouldRerender = shouldRerender || Boolean(getCachedRuntimeTranslation({
            language: language.code,
            text,
          }));
        });

        if (shouldRerender) {
          setRuntimeTranslationVersion((version) => version + 1);
        }
      })
      .catch(() => {
        pendingTexts.forEach((text) => {
          runtimeTranslationPendingRef.current.delete(text);
        });
      });
  }, [language.code, runtimeTranslationRequestSignal]);

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
      const localePackReady = hasLoadedMarketMessagePack(language.code);
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

      // Wait for the locale pack before falling back to ad hoc runtime translation.
      // This avoids spending API calls on copy that already exists in a deferred pack.
      if (!localePackReady) {
        return englishText;
      }

      // Only queue stable catalog templates for runtime translation.
      // Interpolated fallback strings such as timestamps, IDs, and counts
      // would otherwise create a fresh translation job on every render.
      if (!translationTemplate) {
        return englishText;
      }

      const translatedTemplate = getCachedRuntimeTranslation({
        language: language.code,
        text: translationTemplate,
      });
      if (translatedTemplate) {
        return formatMessageTemplate(translatedTemplate, values);
      }

      if (runtimeTranslationPendingRef.current.has(translationTemplate)) {
        return englishText;
      }

      const queue = runtimeTranslationRequestsRef.current;
      if (!queue.has(translationTemplate)) {
        queue.add(translationTemplate);
      }
      return englishText;
    }
  ), [language.code, marketMessageVersion, runtimeTranslationVersion]);

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
