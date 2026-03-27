import { GENERATED_MARKET_MESSAGES } from './generatedMarketMessages';
import { PRIORITY_MARKET_MESSAGES } from './priorityMarketMessages';

const DEFAULT_COUNTRY_CODE = 'IN';
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CURRENCY = 'INR';

export const MARKET_STORAGE_KEY = 'aura_market_preferences_v1';
export const BROWSE_BASE_CURRENCY = 'INR';

export const MARKET_PRESENTMENT_RATES = {
  INR: 1,
  USD: 0.012,
  EUR: 0.011,
  GBP: 0.0095,
  AED: 0.044,
  JPY: 1.82,
  BRL: 0.069,
  CAD: 0.016,
  AUD: 0.018,
  MXN: 0.2,
  CNY: 0.087,
};

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', direction: 'ltr', defaultLocale: 'en-US' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'Hindi', direction: 'ltr', defaultLocale: 'hi-IN' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Espanol', direction: 'ltr', defaultLocale: 'es-ES' },
  { code: 'fr', label: 'French', nativeLabel: 'Francais', direction: 'ltr', defaultLocale: 'fr-FR' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', direction: 'ltr', defaultLocale: 'de-DE' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'Arabic', direction: 'rtl', defaultLocale: 'ar-AE' },
  { code: 'ja', label: 'Japanese', nativeLabel: 'Japanese', direction: 'ltr', defaultLocale: 'ja-JP' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Portugues', direction: 'ltr', defaultLocale: 'pt-BR' },
  { code: 'zh', label: 'Chinese', nativeLabel: 'Chinese', direction: 'ltr', defaultLocale: 'zh-CN' },
];

export const SUPPORTED_MARKETS = [
  {
    countryCode: 'IN',
    label: 'India',
    regionLabel: 'South Asia',
    currency: 'INR',
    locale: 'en-IN',
    defaultLanguage: 'en',
    timeZones: ['Asia/Kolkata', 'Asia/Calcutta'],
  },
  {
    countryCode: 'US',
    label: 'United States',
    regionLabel: 'North America',
    currency: 'USD',
    locale: 'en-US',
    defaultLanguage: 'en',
    timeZones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
  },
  {
    countryCode: 'GB',
    label: 'United Kingdom',
    regionLabel: 'Europe',
    currency: 'GBP',
    locale: 'en-GB',
    defaultLanguage: 'en',
    timeZones: ['Europe/London'],
  },
  {
    countryCode: 'DE',
    label: 'Germany',
    regionLabel: 'Europe',
    currency: 'EUR',
    locale: 'de-DE',
    defaultLanguage: 'de',
    timeZones: ['Europe/Berlin'],
  },
  {
    countryCode: 'FR',
    label: 'France',
    regionLabel: 'Europe',
    currency: 'EUR',
    locale: 'fr-FR',
    defaultLanguage: 'fr',
    timeZones: ['Europe/Paris'],
  },
  {
    countryCode: 'ES',
    label: 'Spain',
    regionLabel: 'Europe',
    currency: 'EUR',
    locale: 'es-ES',
    defaultLanguage: 'es',
    timeZones: ['Europe/Madrid'],
  },
  {
    countryCode: 'AE',
    label: 'United Arab Emirates',
    regionLabel: 'Middle East',
    currency: 'AED',
    locale: 'ar-AE',
    defaultLanguage: 'ar',
    timeZones: ['Asia/Dubai'],
  },
  {
    countryCode: 'JP',
    label: 'Japan',
    regionLabel: 'East Asia',
    currency: 'JPY',
    locale: 'ja-JP',
    defaultLanguage: 'ja',
    timeZones: ['Asia/Tokyo'],
  },
  {
    countryCode: 'BR',
    label: 'Brazil',
    regionLabel: 'Latin America',
    currency: 'BRL',
    locale: 'pt-BR',
    defaultLanguage: 'pt',
    timeZones: ['America/Sao_Paulo'],
  },
  {
    countryCode: 'CA',
    label: 'Canada',
    regionLabel: 'North America',
    currency: 'CAD',
    locale: 'en-CA',
    defaultLanguage: 'en',
    timeZones: ['America/Toronto', 'America/Vancouver'],
  },
  {
    countryCode: 'AU',
    label: 'Australia',
    regionLabel: 'Oceania',
    currency: 'AUD',
    locale: 'en-AU',
    defaultLanguage: 'en',
    timeZones: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth'],
  },
  {
    countryCode: 'MX',
    label: 'Mexico',
    regionLabel: 'North America',
    currency: 'MXN',
    locale: 'es-MX',
    defaultLanguage: 'es',
    timeZones: ['America/Mexico_City'],
  },
  {
    countryCode: 'CN',
    label: 'China',
    regionLabel: 'East Asia',
    currency: 'CNY',
    locale: 'zh-CN',
    defaultLanguage: 'zh',
    timeZones: ['Asia/Shanghai'],
  },
];

export const marketRules = SUPPORTED_MARKETS.reduce((result, market) => {
  result[market.countryCode] = {
    currency: market.currency,
    paymentMethods: market.countryCode === 'IN'
      ? ['UPI', 'CARD', 'COD', 'WALLET', 'NETBANKING']
      : ['CARD'],
    featuredProducts: [],
    restrictedProducts: [],
  };
  return result;
}, {});

const EN_MESSAGES = {
  'market.title': 'Market Studio',
  'market.subtitle': 'Tune country, language, and browse currency without losing your place.',
  'market.country': 'Country',
  'market.language': 'Language',
  'market.currency': 'Currency',
  'market.detected': 'Detected',
  'market.region': 'Region',
  'market.reset': 'Reset to detected market',
  'market.priceHint': 'Catalog prices convert from INR for browsing. Final payment quotes lock at checkout.',
  'market.voiceHint': 'Voice commands, dates, and UI copy follow the selected language and locale where translated.',
  'market.localPrices': 'Local prices',
  'market.estimated': 'Estimated browse FX',
  'market.exact': 'Native catalog FX',
  'nav.searchDesktop': 'Search products, brands, and live deals',
  'nav.searchMobile': 'Search products, categories, and actions...',
  'nav.searchFallbackOpen': 'Open search',
  'nav.notificationsUnavailable': 'Notifications temporarily unavailable',
  'nav.notificationsUnavailableTitle': 'Notifications are temporarily unavailable',
  'nav.preferences': 'Preferences',
  'nav.colorMode': 'Color mode',
  'nav.motion': 'Motion',
  'nav.motionProfile': 'Motion profile',
  'nav.selected': 'Selected',
  'nav.effective': 'Effective',
  'nav.voiceUnavailableTitle': 'Voice search unavailable',
  'nav.voiceUnavailableBody': 'The voice assistant failed in this tab. Use typed search now and reopen voice search after a refresh.',
  'nav.useTypedSearch': 'Use typed search',
  'nav.close': 'Close',
  'nav.quickAccess': 'Quick access',
  'nav.browseByCategory': 'Browse by category',
  'nav.accountControl': 'Account control',
  'nav.experience': 'Experience',
  'nav.loginSignup': 'Login / Sign up',
  'nav.login': 'Login',
  'nav.logout': 'Logout',
  'nav.marketplace': 'Marketplace',
  'nav.missionOs': 'Mission OS',
  'nav.aiCompare': 'AI Compare',
  'nav.visualSearch': 'Visual Search',
  'nav.smartBundles': 'Smart Bundles',
  'nav.wishlist': 'Wishlist',
  'nav.orders': 'Orders',
  'nav.profile': 'My profile',
  'nav.myListings': 'My listings',
  'nav.adminPortal': 'Admin portal',
  'nav.productControl': 'Product control',
  'nav.userGovernance': 'User governance',
  'nav.customerSupport': 'Customer support',
  'nav.sell': 'Sell',
  'nav.becomeSeller': 'Become seller',
  'nav.cart': 'Cart',
  'nav.autoMotionNotice': 'Auto performance mode is overriding the selected motion profile to keep interactions stable.',
  'search.title': 'Search Intelligence',
  'search.subtitle': 'Run live search first. Open advanced controls only when you need tighter filtering.',
  'search.controls': 'Controls',
  'search.run': 'Run Search',
  'search.controlsTitle': 'Search Controls',
  'search.saveIntent': 'Save Intent',
  'search.category': 'Category',
  'search.sort': 'Sort',
  'search.budgetCap': 'Budget Cap',
  'search.loading': 'Scanning live catalog...',
  'search.liveSuggestions': 'Live Suggestions',
  'search.noMatches': 'No direct matches yet. Press Enter to run a full catalog search.',
  'search.recent': 'Recent',
  'search.recentEmpty': 'Your recent searches will appear here.',
  'search.trending': 'Trending',
  'search.savedIntents': 'Saved Intents',
  'search.quickActions': 'Quick Actions',
  'search.clear': 'Clear',
  'search.searchNow': 'Search now',
  'search.voice': 'Voice search',
  'search.clearSearch': 'Clear search',
  'search.globalLabel': 'Global search',
  'voice.title': 'Aura Voice Assistant',
  'voice.subtitle': 'Browser capture plus server-backed command reasoning',
  'voice.mute': 'Mute assistant voice',
  'voice.enable': 'Enable assistant voice',
  'voice.microphone': 'Microphone',
  'voice.retry': 'Retry',
  'voice.heard': 'I Heard',
  'voice.waiting': 'Waiting for your command...',
  'voice.listening': 'Listening for command...',
  'voice.resolving': 'Aura is resolving your command...',
  'voice.typeCommand': 'Type Command',
  'voice.commandPlaceholder': 'Example: search for bluetooth headphones',
  'voice.executeTyped': 'Execute typed command',
  'voice.commandLibrary': 'Voice Commands',
  'voice.captureUnavailable': 'Voice capture is unavailable in this browser. Typed command mode is enabled.',
  'status.runtime': 'Runtime Status',
  'status.retry': 'Retry Check',
  'status.reload': 'Reload App',
  'status.warmingTitle': 'Backend waking up',
  'status.warmingMessage': 'The backend is restarting or reconnecting dependencies. The first request can fail while the runtime settles, so retry in a few seconds.',
  'status.unavailableTitle': 'Backend unavailable',
  'status.unavailableMessage': 'The frontend cannot reach a healthy backend right now. Requests are failing before the API responds cleanly.',
  'status.degradedTitle': 'Backend health degraded',
  'status.degradedMessage': 'The API is responding, but the health endpoint is reporting a degraded or unready state.',
  'status.debugRef': 'Debug Ref {{reference}}',
  'status.checkedAt': 'Checked {{time}}',
  'footer.securityOps': 'Security Operations',
  'footer.systemHealth': 'System Health',
  'footer.paymentSafety': 'Payments Safety',
  'footer.emailSecurity': 'Email Security',
  'footer.incidentSupport': 'Incident Support',
  'footer.expressDelivery': 'Express Delivery',
  'footer.expressDeliveryBody': 'Fast shipping on all orders',
  'footer.easyReturns': 'Easy Returns',
  'footer.easyReturnsBody': '30 days hassle-free return policy',
  'footer.secureCheckout': 'Secure Checkout',
  'footer.secureCheckoutBody': 'Server-authoritative transaction checks',
  'footer.flexiblePayments': 'Flexible Payments',
  'footer.flexiblePaymentsBody': 'Tokenized methods with protected fallback paths',
  'footer.network': 'Aura Network',
  'footer.headline': 'Commerce should feel assured before it feels fast.',
  'footer.body': 'Aura is built to feel like a premium retail operating system: trusted product discovery, clear transaction signals, and a marketplace layer that still looks composed under pressure.',
  'footer.trustCenter': 'Open Trust Center',
  'footer.exploreMarketplace': 'Explore Marketplace',
  'footer.about': 'About',
  'footer.support': 'Support',
  'footer.legal': 'Legal',
  'footer.networkLinks': 'Network',
  'footer.headquarters': 'Headquarters',
  'footer.rights': 'All Rights Reserved.',
  'product.goodDeal': 'Good Deal',
  'product.skipNow': 'Skip For Now',
  'product.watchPrice': 'Watch Price',
  'product.reviewSignal': 'Review Signal',
  'product.sponsored': 'Sponsored',
  'product.demoCatalog': 'Demo Catalog',
  'product.fastDispatch': 'Fast dispatch',
  'product.reviews': 'reviews',
  'product.off': '% off',
  'product.inStock': '{{count}} in stock',
  'product.unavailable': 'Unavailable',
  'product.soldOut': 'Sold Out',
  'product.addToBag': 'Add to Bag',
  'product.addToCart': 'Add to cart',
  'product.viewDetails': 'View details',
  'product.select': 'Select',
  'product.cartSummary': 'Cart summary',
  'product.items': 'Items',
  'product.total': 'Total',
  'product.saved': 'Saved',
  'product.closestMatches': 'No exact match for "{{query}}". Showing closest matches{{confidence}}',
};

const SIMPLE_OVERRIDES = {
  hi: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Desh, bhasha, aur browse currency ko turant badaliye.',
    'market.priceHint': 'Catalog prices browsing ke liye INR se convert hote hain. Final payment quote checkout par lock hota hai.',
    'nav.preferences': 'Preferences',
    'nav.marketplace': 'Marketplace',
    'nav.cart': 'Cart',
    'nav.orders': 'Orders',
    'nav.login': 'Login',
    'nav.logout': 'Logout',
    'search.title': 'Search Intelligence',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'status.retry': 'Retry Check',
    'footer.headline': 'Commerce ko fast se pehle assured feel hona chahiye.',
    'product.addToBag': 'Add to Bag',
    ...(PRIORITY_MARKET_MESSAGES.hi || {}),
  },
  es: {
    'market.title': 'Centro de mercado',
    'market.subtitle': 'Cambia pais, idioma y moneda de exploracion sin perder tu lugar.',
    'market.priceHint': 'Los precios del catalogo se convierten desde INR para explorar. La cotizacion final se fija en checkout.',
    'nav.preferences': 'Preferencias',
    'search.title': 'Inteligencia de busqueda',
    'search.run': 'Buscar',
    'voice.title': 'Asistente de voz Aura',
    'footer.headline': 'El comercio debe sentirse seguro antes de sentirse rapido.',
    'product.addToBag': 'Agregar',
    ...(PRIORITY_MARKET_MESSAGES.es || {}),
  },
  fr: {
    'market.title': 'Studio marche',
    'market.subtitle': 'Ajustez pays, langue et devise sans perdre votre place.',
    'nav.preferences': 'Preferences',
    'search.run': 'Rechercher',
    'voice.title': 'Assistant vocal Aura',
    'footer.headline': 'Le commerce doit inspirer confiance avant de sembler rapide.',
    ...(PRIORITY_MARKET_MESSAGES.fr || {}),
  },
  de: {
    'market.title': 'Markt Studio',
    'market.subtitle': 'Land, Sprache und Wahrung anpassen, ohne den Kontext zu verlieren.',
    'nav.preferences': 'Einstellungen',
    'search.run': 'Suche starten',
    'voice.title': 'Aura Sprachassistent',
    'footer.headline': 'Handel sollte sich sicher anfuhlen, bevor er sich schnell anfuhlt.',
    ...(PRIORITY_MARKET_MESSAGES.de || {}),
  },
  ar: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Ghyyir albalad wal lugha walomla badun faqd makanak.',
    'nav.preferences': 'Preferences',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Yajeb an yabdu altasawwuq mauthuqan qabl an yabdu sariaan.',
    ...(PRIORITY_MARKET_MESSAGES.ar || {}),
  },
  ja: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Kuni, gengo, tsuka o erande mo ima no basho wa sono mama desu.',
    'nav.preferences': 'Preferences',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Commerce should feel assured before it feels fast.',
    ...(PRIORITY_MARKET_MESSAGES.ja || {}),
  },
  pt: {
    'market.title': 'Estudio de mercado',
    'market.subtitle': 'Ajuste pais, idioma e moeda sem perder seu lugar.',
    'nav.preferences': 'Preferencias',
    'search.run': 'Buscar',
    'voice.title': 'Assistente de voz Aura',
    'footer.headline': 'O comercio deve parecer confiavel antes de parecer rapido.',
    ...(PRIORITY_MARKET_MESSAGES.pt || {}),
  },
  zh: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Qiehuan guojia, yuyan he huobi, dan bu hui diu shi dangqian weizhi.',
    'nav.preferences': 'Preferences',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Commerce should feel assured before it feels fast.',
    ...(PRIORITY_MARKET_MESSAGES.zh || {}),
  },
};

export const MARKET_MESSAGES = SUPPORTED_LANGUAGES.reduce((result, language) => {
  const code = language.code;
  const generatedMessages = GENERATED_MARKET_MESSAGES[code] || {};
  const curatedMessages = code === 'en' ? EN_MESSAGES : (SIMPLE_OVERRIDES[code] || {});

  result[code] = {
    ...generatedMessages,
    ...curatedMessages,
  };

  return result;
}, {});

const getRegionFromLocale = (localeValue = '') => {
  const locale = String(localeValue || '').trim();
  if (!locale) return '';

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Locale === 'function') {
      return new Intl.Locale(locale).region || '';
    }
  } catch {
    // Ignore locale parsing failures and fall back to string parsing.
  }

  const parts = locale.replace('_', '-').split('-');
  return parts[1]?.toUpperCase() || '';
};

export const getSupportedMarket = (countryCode = DEFAULT_COUNTRY_CODE) => (
  SUPPORTED_MARKETS.find((market) => market.countryCode === String(countryCode || '').trim().toUpperCase())
  || SUPPORTED_MARKETS.find((market) => market.countryCode === DEFAULT_COUNTRY_CODE)
);

export const getSupportedLanguage = (languageCode = DEFAULT_LANGUAGE_CODE) => (
  SUPPORTED_LANGUAGES.find((language) => language.code === String(languageCode || '').trim().toLowerCase())
  || SUPPORTED_LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE_CODE)
);

export const getSupportedCurrency = (currencyCode = DEFAULT_CURRENCY) => {
  const normalized = String(currencyCode || '').trim().toUpperCase() || DEFAULT_CURRENCY;
  return Object.prototype.hasOwnProperty.call(MARKET_PRESENTMENT_RATES, normalized)
    ? normalized
    : DEFAULT_CURRENCY;
};

export const resolveLocaleForSelection = (languageCode = DEFAULT_LANGUAGE_CODE, countryCode = DEFAULT_COUNTRY_CODE) => {
  const language = getSupportedLanguage(languageCode);
  const market = getSupportedMarket(countryCode);
  if (market.defaultLanguage === language.code) {
    return market.locale;
  }
  return language.defaultLocale || market.locale || 'en-US';
};

export const normalizeMarketPreference = (input = {}) => {
  const market = getSupportedMarket(input.countryCode);
  const language = getSupportedLanguage(input.language || market.defaultLanguage);
  const currency = getSupportedCurrency(input.currency || market.currency);
  const locale = resolveLocaleForSelection(language.code, market.countryCode);

  return {
    countryCode: market.countryCode,
    language: language.code,
    currency,
    locale,
  };
};

export const detectMarketPreference = () => {
  if (typeof window === 'undefined') {
    return {
      ...normalizeMarketPreference({}),
      detectionSource: 'default',
    };
  }

  const languages = [
    window.navigator?.language,
    ...(Array.isArray(window.navigator?.languages) ? window.navigator.languages : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  const primaryLocale = languages[0] || '';
  const regionFromLocale = languages
    .map((locale) => getRegionFromLocale(locale))
    .find(Boolean);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

  const marketFromRegion = regionFromLocale ? getSupportedMarket(regionFromLocale) : null;
  const marketFromTimeZone = SUPPORTED_MARKETS.find((market) => market.timeZones.includes(timeZone)) || null;
  const market = marketFromRegion || marketFromTimeZone || getSupportedMarket(DEFAULT_COUNTRY_CODE);

  const languageFromLocale = languages
    .map((locale) => locale.split(/[-_]/)[0]?.toLowerCase())
    .find((code) => SUPPORTED_LANGUAGES.some((language) => language.code === code));

  const normalized = normalizeMarketPreference({
    countryCode: market.countryCode,
    language: languageFromLocale || market.defaultLanguage,
    currency: market.currency,
  });

  return {
    ...normalized,
    detectionSource: marketFromRegion ? 'locale' : marketFromTimeZone ? 'timezone' : 'default',
  };
};

export const formatMessageTemplate = (template = '', values = {}) => String(template || '').replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, token) => (
  Object.prototype.hasOwnProperty.call(values, token) ? String(values[token]) : ''
));

export const getMessageTemplate = (languageCode = DEFAULT_LANGUAGE_CODE, key = '') => {
  const normalizedLanguage = getSupportedLanguage(languageCode).code;
  return MARKET_MESSAGES[normalizedLanguage]?.[key] || '';
};

const resolveMessageValue = (languageCode = DEFAULT_LANGUAGE_CODE, key = '') => (
  getMessageTemplate(languageCode, key) || MARKET_MESSAGES.en?.[key] || ''
);

export const createTranslator = (languageCode = DEFAULT_LANGUAGE_CODE) => (key, values = {}, fallback = '') => {
  const template = resolveMessageValue(languageCode, key) || fallback || key;
  return formatMessageTemplate(template, values);
};

export const getCountryDisplayName = (countryCode = DEFAULT_COUNTRY_CODE, locale = 'en-US') => {
  const market = getSupportedMarket(countryCode);
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const displayNames = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
      return displayNames.of(market.countryCode) || market.label;
    }
  } catch {
    // Ignore display name errors and use configured labels.
  }
  return market.label;
};

export const getCurrencyDisplayName = (currencyCode = DEFAULT_CURRENCY, locale = 'en-US') => {
  const normalized = getSupportedCurrency(currencyCode);
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const displayNames = new Intl.DisplayNames([locale, 'en'], { type: 'currency' });
      return displayNames.of(normalized) || normalized;
    }
  } catch {
    // Ignore display name errors and use the currency code.
  }
  return normalized;
};

export const DEFAULT_MARKET_PREFERENCE = normalizeMarketPreference({
  countryCode: DEFAULT_COUNTRY_CODE,
  language: DEFAULT_LANGUAGE_CODE,
  currency: DEFAULT_CURRENCY,
});
