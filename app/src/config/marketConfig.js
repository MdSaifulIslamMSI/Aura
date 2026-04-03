import { MARKET_MESSAGE_PACK as EN_GENERATED_MARKET_MESSAGES } from './marketMessagePacks/en.js';

const DEFAULT_COUNTRY_CODE = 'IN';
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CURRENCY = 'INR';
const MARKET_MESSAGE_PACK_LOADERS = import.meta.glob('./marketMessagePacks/*.js');

export const MARKET_STORAGE_KEY = 'aura_market_preferences_v1';
export const BROWSE_BASE_CURRENCY = 'INR';

// Snapshot fallback used before the live ECB refresh completes.
export const MARKET_PRESENTMENT_RATES = {
  INR: 1,
  USD: 0.0107033498118,
  EUR: 0.00922305024718,
  GBP: 0.00803447576182,
  AED: 0.039308052184,
  JPY: 1.69455102191,
  BRL: 0.0552267025751,
  CAD: 0.0148712462185,
  AUD: 0.0153923485575,
  MXN: 0.191090533461,
  CNY: 0.0735731941268,
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
  'market.regionFallback': 'your region',
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
  'nav.network': 'Network',
  'nav.sellerDesk': 'Seller Desk',
  'nav.priceAlerts': 'Price Alerts',
  'nav.openQuickPanel': 'Open quick access panel',
  'nav.openMarketPanel': 'Open market settings',
  'nav.closeMarketBackdrop': 'Close market panel backdrop',
  'nav.closeExploreBackdrop': 'Close explore panel backdrop',
  'nav.explore': 'Explore',
  'nav.exploreTitle': 'Curated routes for higher-intent shopping.',
  'nav.exploreBody': 'Jump into discovery, comparison, and workspace routes without opening a full control surface.',
  'nav.marketSnapshotTitle': 'Browse tuned to your market.',
  'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
  'nav.tuneMarket': 'Tune market',
  'nav.marketPanelTitle': 'Country, language, and currency controls.',
  'nav.marketPanelBody': 'Tune browsing without disturbing the main navigation rail.',
  'nav.tools': 'Tools',
  'nav.workspace': 'Workspace',
  'nav.openProfileMenu': 'Open profile menu',
  'nav.closeProfileBackdrop': 'Close profile menu backdrop',
  'nav.auraPoints': '{{count}} AP',
  'nav.adminTools': 'Admin Tools',
  'nav.adminDashboard': 'Admin Dashboard',
  'nav.paymentOps': 'Payment Ops',
  'nav.toggleMenu': 'Toggle menu',
  'nav.closeMobileMenuBackdrop': 'Close mobile menu backdrop',
  'nav.motionCinematic': 'Full transitions and richer movement.',
  'nav.motionBalanced': 'Default motion with lighter overhead.',
  'nav.motionMinimal': 'Reduced motion for clarity and speed.',
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
  'search.allCategories': 'All Categories',
  'search.sort.relevance': 'Relevance',
  'search.sort.rating': 'Top Rated',
  'search.sort.newest': 'Newest',
  'search.sort.priceAsc': 'Price: Low to High',
  'search.sort.priceDesc': 'Price: High to Low',
  'search.quickAction.marketplaceDesc': 'Browse peer-to-peer listings',
  'search.quickAction.deals': 'Deals',
  'search.quickAction.dealsDesc': 'Open highest discount picks',
  'search.quickAction.trendingDesc': 'See top rated products',
  'search.quickAction.newArrivals': 'New Arrivals',
  'search.quickAction.newArrivalsDesc': 'Fresh inventory drops',
  'search.quickAction.visualDesc': 'Find products from image hints',
  'search.quickAction.aiCompareDesc': 'Compare up to four products instantly',
  'search.quickAction.smartBundle': 'Smart Bundle',
  'search.quickAction.smartBundleDesc': 'Generate AI bundles with budget slider',
  'search.quickAction.sellItemDesc': 'Create a marketplace listing',
  'search.quickAction.ordersDesc': 'Track placed orders',
  'search.liveSuggestionsError': 'Unable to load live suggestions right now.',
  'search.toggleControls': 'Toggle advanced search controls',
  'search.saveIntentTitle': 'Save semantic intent (Ctrl/Cmd+Enter)',
  'search.productFallback': 'Product',
  'search.untitledProduct': 'Untitled product',
  'search.generalCategory': 'General',
  'search.view': 'View',
  'search.open': 'Open',
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
  'admin.payments.refund.mode.charge': 'Charge Amount',
  'admin.payments.refund.mode.settlement': 'Settlement Amount',
  'admin.support.arch.actionReplyBody': 'Fastest acceleration right now is clearing text backlog so live calls stay reserved for the issues that truly need real-time handling.',
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
  'product.addToWishlist': 'Add to wishlist',
  'product.removeFromWishlist': 'Remove from wishlist',
  'product.compare': 'Compare',
  'product.dealDna': 'Deal DNA',
  'product.bundleAi': 'Bundle AI',
  'product.score': 'Score',
  'product.viewDetails': 'View details',
  'product.select': 'Select',
  'product.cartSummary': 'Cart summary',
  'product.items': 'Items',
  'product.total': 'Total',
  'product.saved': 'Saved',
  'product.closestMatches': 'No exact match for "{{query}}". Showing closest matches{{confidence}}',
  'seller.shared.today': 'Today',
  'seller.shared.yesterday': 'Yesterday',
  'seller.shared.daysAgo': '{{count}}d ago',
  'seller.shared.monthsAgo': '{{count}}mo ago',
  'seller.shared.views': '{{count}} views',
  'seller.shared.unknownCity': 'Unknown city',
  'seller.shared.status.active': 'Active',
  'seller.shared.status.sold': 'Sold',
  'seller.shared.status.all': 'All',
  'seller.shared.posted': 'Posted {{time}}',
  'sellerBecome.title': 'Become a Seller',
  'sellerBecome.body': 'Seller mode protects marketplace quality. Only verified accounts with valid contact info can create listings.',
  'sellerBecome.requirement.verified.ok': 'Account verification complete',
  'sellerBecome.requirement.verified.missing': 'Account verification required',
  'sellerBecome.requirement.phone.ok': 'Phone on file: {{phone}}',
  'sellerBecome.requirement.phone.missing': 'Add phone number in profile',
  'sellerBecome.requirement.mode.ok': 'Seller mode already active',
  'sellerBecome.requirement.mode.missing': 'Seller mode not active yet',
  'sellerBecome.error.addPhone': 'Add a valid phone number in your profile before seller activation.',
  'sellerBecome.error.verificationRequired': 'Account verification is required before seller activation.',
  'sellerBecome.success.activated': 'Seller mode activated. You can now post listings.',
  'sellerBecome.error.activateFailed': 'Failed to activate seller mode',
  'sellerBecome.confirmDeactivate': 'Deactivate seller mode? You will lose access to /sell until you activate it again.',
  'sellerBecome.success.deactivated': 'Seller mode deactivated.',
  'sellerBecome.error.deactivateFailed': 'Failed to deactivate seller mode',
  'sellerBecome.activate': 'Activate Seller Mode',
  'sellerBecome.activating': 'Activating...',
  'sellerBecome.goToSell': 'Go to Sell',
  'sellerBecome.deactivate': 'Deactivate Seller Mode',
  'sellerBecome.deactivating': 'Deactivating...',
  'sellerBecome.openProfile': 'Open Profile',
  'sellerListings.title': 'My Listings',
  'sellerListings.subtitle': 'Manage active items, sold history, and marketplace visibility.',
  'sellerListings.newListing': 'New Listing',
  'sellerListings.stats.active': 'Active',
  'sellerListings.stats.sold': 'Sold',
  'sellerListings.stats.totalViews': 'Total Views',
  'sellerListings.emptyTitle.active': 'No active listings',
  'sellerListings.emptyTitle.sold': 'No sold listings',
  'sellerListings.emptyTitle.all': 'No listings yet',
  'sellerListings.emptyBodyActive': 'Create your first live listing and start getting buyers.',
  'sellerListings.emptyBodyGeneric': 'No items in this state yet.',
  'sellerListings.createListing': 'Create listing',
  'sellerListings.error.markSold': 'Unable to mark listing as sold right now.',
  'sellerListings.confirmDelete': 'Delete this listing permanently?',
  'sellerListings.error.delete': 'Unable to delete listing right now.',
  'sellerListings.escrowOptIn': 'Escrow Opt-in',
  'sellerListings.escrowState': 'Escrow {{state}}',
  'sellerListings.markSold': 'Mark sold',
  'sellerListings.delete': 'Delete',
  'sellerProfile.loading': 'Loading seller profile...',
  'sellerProfile.notFoundTitle': 'Seller not found',
  'sellerProfile.backToMarketplace': 'Back to Marketplace',
  'sellerProfile.memberSince': 'Member since {{date}}',
  'sellerProfile.stats.activeListings': 'Active listings',
  'sellerProfile.stats.soldItems': 'Sold items',
  'sellerProfile.stats.trustScore': 'Trust score',
  'sellerProfile.passportTitle': 'Seller Trust Passport',
  'sellerProfile.passport.fraudRisk': 'Fraud Risk',
  'sellerProfile.passport.disputeRate': 'Dispute Rate',
  'sellerProfile.passport.onTimeHistory': 'On-time History',
  'sellerProfile.passport.responseSla': 'Response SLA',
  'sellerProfile.passport.highRiskNotice': 'High risk tier means extra care is recommended before payment.',
  'sellerProfile.activeListingsTitle': 'Active Listings ({{count}})',
  'sellerProfile.emptyListings': 'This seller has no active listings right now.',
  'sellerProfile.negotiable': 'Negotiable',
};

const SIMPLE_OVERRIDES = {
  hi: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Desh, bhasha, aur browse currency ko turant badaliye.',
    'market.regionFallback': 'aapka region',
    'market.priceHint': 'Catalog prices browsing ke liye INR se convert hote hain. Final payment quote checkout par lock hota hai.',
    'nav.preferences': 'Preferences',
    'nav.marketplace': 'Marketplace',
    'nav.cart': 'Cart',
    'nav.orders': 'Orders',
    'nav.login': 'Login',
    'nav.logout': 'Logout',
    'nav.openMarketPanel': 'Market settings kholo',
    'nav.closeMarketBackdrop': 'Market panel backdrop band karo',
    'nav.marketSnapshotTitle': 'Browse ab aapke market ke hisaab se tuned hai.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Market tune karo',
    'nav.marketPanelTitle': 'Desh, bhasha, aur currency controls.',
    'nav.marketPanelBody': 'Browse settings ko alag rakho aur main explore rail ko clean rakho.',
    'search.title': 'Search Intelligence',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'status.retry': 'Retry Check',
    'footer.headline': 'Commerce ko fast se pehle assured feel hona chahiye.',
    'product.addToBag': 'Add to Bag',
    'productPage.curatedHardware': 'Curated hardware',
    'productPage.liveMarketFx': 'Live market FX',
    'productPage.marketSnapshot': 'Market snapshot',
    'productPage.trustScore': 'Trust score',
    'productPage.trustScoreValue': 'Trust score {{value}}/100',
    'productPage.marketPrice': 'Market price',
    'productPage.fxPinned': 'FX pinned to {{currency}} browse rates',
    'productPage.dealVerdict': 'Deal verdict',
    'productPage.ratingSummary': '{{rating}} rating from {{count}} reviews',
    'productPage.deliveryPromise': 'Delivery promise',
    'productPage.coverage': 'Coverage',
    'productPage.premiumProtection': 'Premium protection',
    'productPage.concierge': 'Concierge',
    'productPage.needHelpNow': 'Abhi help chahiye?',
    'productPage.conciergeBody': 'Product questions ya order edge cases ke liye concierge support ready hai.',
    'productPage.premiumSelection': 'Premium selection',
    'productPage.livePrice': 'Live price',
    'productPage.curatorNote': 'Curator note',
    'productPage.curatorBody': 'Yeh pick trust, performance aur long-term value ko balance karta hai.',
  },
  es: {
    'market.title': 'Centro de mercado',
    'market.subtitle': 'Cambia pais, idioma y moneda de exploracion sin perder tu lugar.',
    'market.regionFallback': 'tu region',
    'market.priceHint': 'Los precios del catalogo se convierten desde INR para explorar. La cotizacion final se fija en checkout.',
    'nav.preferences': 'Preferencias',
    'nav.openMarketPanel': 'Abrir ajustes de mercado',
    'nav.closeMarketBackdrop': 'Cerrar fondo del panel de mercado',
    'nav.marketSnapshotTitle': 'La navegacion ya esta ajustada a tu mercado.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Ajustar mercado',
    'nav.marketPanelTitle': 'Controles de pais, idioma y moneda.',
    'nav.marketPanelBody': 'Ajusta la navegacion sin recargar la superficie principal.',
    'search.title': 'Inteligencia de busqueda',
    'search.run': 'Buscar',
    'voice.title': 'Asistente de voz Aura',
    'footer.headline': 'El comercio debe sentirse seguro antes de sentirse rapido.',
    'product.addToBag': 'Agregar',
  },
  fr: {
    'market.title': 'Studio marche',
    'market.subtitle': 'Ajustez pays, langue et devise sans perdre votre place.',
    'market.regionFallback': 'votre region',
    'nav.preferences': 'Preferences',
    'nav.openMarketPanel': 'Ouvrir les reglages du marche',
    'nav.closeMarketBackdrop': 'Fermer l arriere-plan du panneau marche',
    'nav.marketSnapshotTitle': 'La navigation suit deja votre marche.',
    'nav.marketSnapshotBody': 'Region : {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Ajuster le marche',
    'nav.marketPanelTitle': 'Controles pays, langue et devise.',
    'nav.marketPanelBody': 'Ajustez le parcours sans encombrer la navigation principale.',
    'search.run': 'Rechercher',
    'voice.title': 'Assistant vocal Aura',
    'footer.headline': 'Le commerce doit inspirer confiance avant de sembler rapide.',
  },
  de: {
    'market.title': 'Markt Studio',
    'market.subtitle': 'Land, Sprache und Wahrung anpassen, ohne den Kontext zu verlieren.',
    'market.regionFallback': 'Ihre Region',
    'nav.preferences': 'Einstellungen',
    'nav.openMarketPanel': 'Markteinstellungen offnen',
    'nav.closeMarketBackdrop': 'Hintergrund des Marktpanels schliessen',
    'nav.marketSnapshotTitle': 'Das Browsing ist bereits auf Ihren Markt abgestimmt.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Markt anpassen',
    'nav.marketPanelTitle': 'Steuerung fur Land, Sprache und Wahrung.',
    'nav.marketPanelBody': 'Passen Sie das Browsing an, ohne die Hauptnavigation zu uberladen.',
    'search.run': 'Suche starten',
    'voice.title': 'Aura Sprachassistent',
    'footer.headline': 'Handel sollte sich sicher anfuhlen, bevor er sich schnell anfuhlt.',
  },
  ar: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Ghyyir albalad wal lugha walomla badun faqd makanak.',
    'market.regionFallback': 'mintaqatak',
    'nav.preferences': 'Preferences',
    'nav.openMarketPanel': 'Iftah iedadat alsouq',
    'nav.closeMarketBackdrop': 'Aghliq khalfiya panel alsouq',
    'nav.marketSnapshotTitle': 'Altasafuh mutawafiq ma souqak.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Addil alsouq',
    'nav.marketPanelTitle': 'Tahakkum albalad wallugha walomla.',
    'nav.marketPanelBody': 'Addil altasafuh bidun izdihaam fi almalah alraisi.',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Yajeb an yabdu altasawwuq mauthuqan qabl an yabdu sariaan.',
  },
  ja: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Kuni, gengo, tsuka o erande mo ima no basho wa sono mama desu.',
    'market.regionFallback': 'anata no chiiki',
    'nav.preferences': 'Preferences',
    'nav.openMarketPanel': 'Market settings o hiraku',
    'nav.closeMarketBackdrop': 'Market panel backdrop o tojiru',
    'nav.marketSnapshotTitle': 'Browsing wa anata no market ni awasete chousei sarete imasu.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Market o chousei',
    'nav.marketPanelTitle': 'Kuni, gengo, tsuka no control.',
    'nav.marketPanelBody': 'Main navigation o midasazu browsing settei o chousei shimasu.',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Commerce should feel assured before it feels fast.',
  },
  pt: {
    'market.title': 'Estudio de mercado',
    'market.subtitle': 'Ajuste pais, idioma e moeda sem perder seu lugar.',
    'market.regionFallback': 'sua regiao',
    'nav.preferences': 'Preferencias',
    'nav.openMarketPanel': 'Abrir configuracoes de mercado',
    'nav.closeMarketBackdrop': 'Fechar fundo do painel de mercado',
    'nav.marketSnapshotTitle': 'A navegacao ja esta ajustada ao seu mercado.',
    'nav.marketSnapshotBody': 'Regiao: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'Ajustar mercado',
    'nav.marketPanelTitle': 'Controles de pais, idioma e moeda.',
    'nav.marketPanelBody': 'Ajuste a navegacao sem pesar a superficie principal.',
    'search.run': 'Buscar',
    'voice.title': 'Assistente de voz Aura',
    'footer.headline': 'O comercio deve parecer confiavel antes de parecer rapido.',
  },
  zh: {
    'market.title': 'Market Studio',
    'market.subtitle': 'Qiehuan guojia, yuyan he huobi, dan bu hui diu shi dangqian weizhi.',
    'market.regionFallback': 'ni de diqu',
    'nav.preferences': 'Preferences',
    'nav.openMarketPanel': 'dakai shichang shezhi',
    'nav.closeMarketBackdrop': 'guanbi shichang mianban beijing',
    'nav.marketSnapshotTitle': 'liulan yijing an ni de shichang tiaozheng.',
    'nav.marketSnapshotBody': 'Region: {{region}}. {{browseCurrencyNote}}',
    'nav.tuneMarket': 'tiaozheng shichang',
    'nav.marketPanelTitle': 'guojia, yuyan he huobi kongzhi.',
    'nav.marketPanelBody': 'tiaozheng liulan, dan bu rao luan zhu daohang.',
    'search.run': 'Run Search',
    'voice.title': 'Aura Voice Assistant',
    'footer.headline': 'Commerce should feel assured before it feels fast.',
  },
};

const NON_ENGLISH_RUNTIME_MESSAGE_BACKFILL = {
  'productPage.curatedHardware': 'Curated hardware',
  'productPage.liveMarketFx': 'Live market FX',
  'productPage.marketSnapshot': 'Market snapshot',
  'productPage.trustScore': 'Trust score',
  'productPage.trustScoreValue': 'Trust score {{value}}/100',
  'productPage.marketPrice': 'Market price',
  'productPage.fxPinned': 'FX pinned to {{currency}} browse rates',
  'productPage.dealVerdict': 'Deal verdict',
  'productPage.ratingSummary': '{{rating}} rating from {{count}} reviews',
  'productPage.deliveryPromise': 'Delivery promise',
  'productPage.coverage': 'Coverage',
  'productPage.premiumProtection': 'Premium protection',
  'productPage.concierge': 'Concierge',
  'productPage.needHelpNow': 'Need help now?',
  'productPage.conciergeBody': 'Concierge support is ready for product questions and order edge cases.',
  'productPage.premiumSelection': 'Premium selection',
  'productPage.livePrice': 'Live price',
  'productPage.curatorNote': 'Curator note',
  'productPage.curatorBody': 'This pick balances trust, performance, and long-term value.',
  'auth.deviceChallenge.title': 'Trusted device checkpoint',
  'auth.deviceChallenge.message': 'Approve this browser in the security checkpoint to continue.',
  'admin.support.arch.openQueue': 'Open queue',
  'admin.support.arch.openQueueBody': '{{total}} total threads are in the current queue view.',
  'admin.support.arch.needsReply': 'Needs reply',
  'admin.support.arch.needsReplyBody': '{{count}} unread customer messages are waiting for staff review.',
  'admin.support.arch.liveLanes': 'Live lanes',
  'admin.support.arch.liveLanesBody': '{{connected}} connected and {{queued}} preparing or queued.',
  'admin.support.arch.voiceLanes': 'Voice lanes',
  'admin.support.arch.voiceLanesBody': '{{video}} video lanes are active or queued beside voice.',
  'admin.support.arch.urgent': 'Urgent',
  'admin.support.arch.urgentBody': '{{stale}} open threads are aging past the fast-response window.',
  'admin.support.arch.action': 'Action focus',
  'admin.support.arch.actionReplyTitle': '{{count}} threads are waiting on a staff reply',
  'admin.support.arch.actionReplyBody': 'Fastest acceleration right now is clearing text backlog so live calls stay reserved for the issues that truly need real-time handling.',
  'admin.support.arch.actionLiveTitle': '{{count}} live support lanes are active',
  'admin.support.arch.actionLiveBody': 'Keep the queue moving by using chat for lightweight follow-up while voice and video handle the trust-critical moments.',
  'admin.support.arch.actionUrgentTitle': '{{count}} urgent cases are in scope',
  'admin.support.arch.actionUrgentBody': 'Moderation and high-trust issues should move through a tight chat-to-call path so the resolution notes stay durable after the live interaction ends.',
  'admin.support.arch.actionStableTitle': 'Queue is stable and ready to accelerate',
  'admin.support.arch.actionStableBody': 'Use voice and video selectively while the durable chat trail continues to carry the official resolution record.',
  'admin.support.arch.focusBadge': 'Focused on {{subject}}',
  'admin.support.arch.focusNone': 'Queue-wide view',
  'admin.support.arch.eyebrow': 'Omnichannel architecture',
  'admin.support.arch.title': 'Chat, voice, and video now move as one support system',
  'admin.support.arch.description': 'Keep durable chat history, accelerate into voice or video when necessary, and manage the whole queue with live operational context.',
  'admin.support.voiceDraftHint': 'Voice drafting keeps the response in this same support thread before you send it.',
  'admin.support.voiceDraft': 'Voice draft',
  'admin.support.voiceDraftStop': 'Stop voice',
  'login.acceleration.resume': 'Resumable flow',
  'login.acceleration.resumeTitle': 'Fast recovery ready',
  'login.acceleration.resumeBody': 'Your previous secure auth attempt can be restarted with the saved identity details.',
  'login.acceleration.savedAt': 'Saved {{age}}',
  'login.acceleration.identityTitle': 'Known identity',
  'login.acceleration.identityBody': 'Last secure session used {{assurance}} via {{provider}} {{age}}.',
  'login.acceleration.justNow': 'just now',
  'login.acceleration.identityBodyFallback': 'Last secure session used {{provider}} {{age}}.',
  'login.acceleration.identity': 'Known identity',
  'login.acceleration.useIdentity': 'Use saved identity',
  'login.acceleration.lane': 'Fastest lane',
  'profile.support.arch.threads': 'Threads',
  'profile.support.arch.threadsBody': '{{open}} conversations are still open for follow-up.',
  'profile.support.arch.replyNeeded': 'Reply needed',
  'profile.support.arch.replyNeededBody': '{{count}} threads have unread support replies for you.',
  'profile.support.arch.liveLanes': 'Live support',
  'profile.support.arch.liveLanesBody': '{{connected}} live calls are already connected across your support threads.',
  'profile.support.arch.voiceLanes': 'Voice ready',
  'profile.support.arch.voiceLanesBody': '{{video}} video escalations can happen without losing the chat trail.',
  'profile.support.arch.nextStep': 'Next step',
  'profile.support.arch.joinTitle': 'Aura Support already opened a {{label}}',
  'profile.support.arch.joinBody': 'Join the live lane from this thread and the chat history stays right here after the call.',
  'profile.support.arch.requestedTitle': 'Your {{label}} request is queued',
  'profile.support.arch.requestedBody': 'Stay in this chat while the support team prepares the call so no context gets lost.',
  'profile.support.arch.replyTitle': '{{count}} support threads are waiting on you',
  'profile.support.arch.replyBody': 'Reply in chat first, then escalate to voice or video only if the issue still needs real-time handling.',
  'profile.support.arch.resolvedTitle': 'Resolution is already captured',
  'profile.support.arch.resolvedBody': 'Keep this thread as the durable record. Open a fresh one only if the issue truly changes.',
  'profile.support.arch.defaultTitle': 'Start in chat and accelerate when needed',
  'profile.support.arch.defaultBody': 'Aura Support can move this same thread into voice or video without losing the written history or the resolution summary.',
  'profile.support.arch.voiceBadgeReady': 'Voice drafting ready',
  'profile.support.arch.voiceBadgeFallback': 'Text drafting only',
  'profile.support.arch.eyebrow': 'Omnichannel support',
  'profile.support.arch.title': 'Chat, voice, and video stay in one support thread',
  'profile.support.arch.description': 'Move from written support into live voice or video without losing history, status, or the eventual resolution.',
  'profile.support.compose.voiceDraft': 'Voice draft',
  'profile.support.compose.voiceDraftStop': 'Stop voice',
};

export const MARKET_MESSAGES = {
  en: {
    ...EN_MESSAGES,
    ...EN_GENERATED_MARKET_MESSAGES,
  },
  ...Object.fromEntries(
    SUPPORTED_LANGUAGES
      .filter(({ code }) => code !== 'en')
      .map(({ code }) => [
        code,
        {
          ...(SIMPLE_OVERRIDES[code] || {}),
          ...NON_ENGLISH_RUNTIME_MESSAGE_BACKFILL,
        },
      ]),
  ),
};

const loadedMarketMessagePackLanguages = new Set(['en']);
const inflightMarketMessagePackLoads = new Map();

const mergeMarketMessages = (languageCode = DEFAULT_LANGUAGE_CODE, messages = {}) => {
  const normalizedLanguage = getSupportedLanguage(languageCode).code;
  MARKET_MESSAGES[normalizedLanguage] = {
    ...(MARKET_MESSAGES[normalizedLanguage] || {}),
    ...(messages || {}),
  };
};

const getMarketMessagePackPath = (languageCode = DEFAULT_LANGUAGE_CODE) => `./marketMessagePacks/${languageCode}.js`;

export const hasLoadedMarketMessagePack = (languageCode = DEFAULT_LANGUAGE_CODE) => (
  loadedMarketMessagePackLanguages.has(getSupportedLanguage(languageCode).code)
);

export const ensureMarketMessagesLoaded = async (languageCode = DEFAULT_LANGUAGE_CODE) => {
  const normalizedLanguage = getSupportedLanguage(languageCode).code;
  if (hasLoadedMarketMessagePack(normalizedLanguage)) {
    return false;
  }

  const inflightLoad = inflightMarketMessagePackLoads.get(normalizedLanguage);
  if (inflightLoad) {
    await inflightLoad;
    return false;
  }

  const loader = MARKET_MESSAGE_PACK_LOADERS[getMarketMessagePackPath(normalizedLanguage)];
  if (!loader) {
    loadedMarketMessagePackLanguages.add(normalizedLanguage);
    return false;
  }

  const loadPromise = loader().then((module) => {
    mergeMarketMessages(normalizedLanguage, module?.MARKET_MESSAGE_PACK || module?.default || {});
    loadedMarketMessagePackLanguages.add(normalizedLanguage);
  });

  inflightMarketMessagePackLoads.set(normalizedLanguage, loadPromise);

  try {
    await loadPromise;
    return true;
  } finally {
    inflightMarketMessagePackLoads.delete(normalizedLanguage);
  }
};

export const ensureAllMarketMessagesLoaded = async () => {
  await Promise.all(SUPPORTED_LANGUAGES.map(({ code }) => ensureMarketMessagesLoaded(code)));
};

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
