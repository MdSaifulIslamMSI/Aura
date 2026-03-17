const CATEGORY_ROUTES = [
  { aliases: ['mobiles', 'mobile', 'phone', 'smartphone'], slug: 'mobiles', label: 'Mobiles' },
  { aliases: ['laptops', 'laptop', 'notebook', 'macbook'], slug: 'laptops', label: 'Laptops' },
  { aliases: ['electronics', 'electronic', 'gadgets', 'earbuds', 'headphones'], slug: 'electronics', label: 'Electronics' },
  { aliases: ['mens fashion', "men's fashion", 'mens'], slug: "men's-fashion", label: "Men's Fashion" },
  { aliases: ['womens fashion', "women's fashion", 'womens', "ladies fashion"], slug: "women's-fashion", label: "Women's Fashion" },
  { aliases: ['home kitchen', 'home', 'kitchen'], slug: 'home-kitchen', label: 'Home & Kitchen' },
  { aliases: ['gaming', 'games', 'console'], slug: 'gaming', label: 'Gaming' },
  { aliases: ['books', 'book'], slug: 'books', label: 'Books' },
  { aliases: ['sports', 'sport', 'fitness'], slug: 'sports', label: 'Sports' },
];

const ROUTE_COMMANDS = [
  { aliases: ['home', 'homepage'], path: '/', label: 'Home' },
  { aliases: ['marketplace', 'market place'], path: '/marketplace', label: 'Marketplace' },
  { aliases: ['cart', 'bag'], path: '/cart', label: 'Cart' },
  { aliases: ['wishlist', 'favorites', 'favourites'], path: '/wishlist', label: 'Wishlist' },
  { aliases: ['orders', 'my orders'], path: '/orders', label: 'Orders' },
  { aliases: ['profile', 'account'], path: '/profile', label: 'Profile' },
  { aliases: ['sell', 'sell item'], path: '/sell', label: 'Sell' },
  { aliases: ['bundles', 'smart bundles', 'bundle'], path: '/bundles', label: 'Bundles' },
  { aliases: ['compare', 'ai compare'], path: '/compare', label: 'AI Compare' },
  { aliases: ['visual search', 'camera search'], path: '/visual-search', label: 'Visual Search' },
  { aliases: ['deals', 'best deals', 'deals today'], path: '/deals', label: 'Deals' },
  { aliases: ['trending', 'hot picks'], path: '/trending', label: 'Trending' },
  { aliases: ['new arrivals', 'latest'], path: '/new-arrivals', label: 'New Arrivals' },
  { aliases: ['mission control', 'command center'], path: '/mission-control', label: 'Mission Control' },
  { aliases: ['checkout'], path: '/checkout', label: 'Checkout' },
];

export const ASSISTANT_COMMAND_HINTS = [
  'Show the best deals today',
  'Search for phones under Rs 30000',
  'Build a gaming bundle under Rs 80000',
  'Open marketplace',
  'Take me to visual search',
  'Go to cart',
];

const ROUTE_LABELS = [
  { match: (pathname) => pathname === '/', label: 'Home command deck' },
  { match: (pathname) => pathname.startsWith('/products') || pathname.startsWith('/category') || pathname.startsWith('/search'), label: 'Catalog intelligence' },
  { match: (pathname) => pathname.startsWith('/product/'), label: 'Product decision room' },
  { match: (pathname) => pathname.startsWith('/marketplace'), label: 'Marketplace scouting' },
  { match: (pathname) => pathname.startsWith('/listing/'), label: 'Seller negotiation lane' },
  { match: (pathname) => pathname.startsWith('/bundles'), label: 'Bundle optimizer' },
  { match: (pathname) => pathname.startsWith('/compare'), label: 'AI compare lab' },
  { match: (pathname) => pathname.startsWith('/visual-search'), label: 'Visual search studio' },
  { match: (pathname) => pathname.startsWith('/mission-control'), label: 'Mission control' },
  { match: (pathname) => pathname.startsWith('/orders'), label: 'Order support desk' },
];

const normalizeText = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const safeString = (value = '') => String(value ?? '').trim();

const findCategoryCommand = (normalized) => {
  for (const category of CATEGORY_ROUTES) {
    if (category.aliases.some((alias) => normalized.includes(alias))) {
      return category;
    }
  }
  return null;
};

const findRouteCommand = (normalized) => {
  for (const route of ROUTE_COMMANDS) {
    if (route.aliases.some((alias) => normalized.includes(alias))) {
      return route;
    }
  }
  return null;
};

const extractBudgetFromText = (rawText, fallback = 75000) => {
  const match = safeString(rawText).match(/(?:budget|under|below|max|within)\s*(?:rs|inr)?\s*([\d,]+)/i);
  if (!match?.[1]) return fallback;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const inferBundleTheme = (rawText = '', pathname = '/') => {
  const normalized = normalizeText(rawText);
  if (/\bgaming|console|stream\b/.test(normalized)) return 'gaming setup';
  if (/\bwork|office|desk|remote\b/.test(normalized)) return 'workstation';
  if (/\btravel|camera|creator|content\b/.test(normalized)) return 'creator kit';
  if (pathname.startsWith('/marketplace')) return 'marketplace flips';
  if (pathname.startsWith('/product')) return 'product-led upgrade';
  return 'smart essentials';
};

export const getAssistantRouteLabel = (pathname = '/') => {
  const matched = ROUTE_LABELS.find((entry) => entry.match(pathname));
  return matched?.label || 'Aura command center';
};

export const parseAssistantCommand = (rawText = '') => {
  const raw = safeString(rawText);
  if (!raw) return { type: 'empty' };

  const normalized = normalizeText(raw);

  if (/\b(help|commands|what can you do)\b/.test(normalized)) {
    return {
      type: 'help',
      message: 'Try search for iPhone fifteen, open marketplace, build a gaming bundle under Rs 80000, or take me to visual search.',
    };
  }

  if (/\b(close|exit|dismiss|hide chat)\b/.test(normalized)) {
    return { type: 'close', message: 'Closing Aura Command.' };
  }

  if (/\b(voice mode|voice assistant|listen to me)\b/.test(normalized)) {
    return { type: 'voice', message: 'Opening the voice assistant.' };
  }

  const productIdMatch = normalized.match(/\b(?:open|show)\s+(?:product|item)\s+(\d{1,})\b/);
  if (productIdMatch?.[1]) {
    return {
      type: 'product',
      productId: productIdMatch[1],
      message: `Opening product ${productIdMatch[1]}.`,
    };
  }

  const categoryIntent = /\b(category|section|show)\b/.test(normalized) ? findCategoryCommand(normalized) : null;
  if (categoryIntent) {
    return {
      type: 'category',
      slug: categoryIntent.slug,
      message: `Opening ${categoryIntent.label}.`,
    };
  }

  const searchMatch = raw.match(/^\s*(?:search(?:\s+for)?|find|look\s+for|show\s+me|buy)\s+(.+)$/i);
  if (searchMatch?.[1]?.trim()) {
    return {
      type: 'search',
      query: searchMatch[1].trim(),
      message: `I can search the catalog for ${searchMatch[1].trim()} and keep the conversation here.`,
    };
  }

  if (/\b(bundle|kit|setup)\b/.test(normalized) && /\b(build|make|create|plan|need)\b/.test(normalized)) {
    return {
      type: 'bundle',
      theme: inferBundleTheme(raw),
      budget: extractBudgetFromText(raw),
      message: 'Building a premium bundle around your budget and intent.',
    };
  }

  const explicitNavigate = /\b(open|go to|navigate to|take me to|show)\b/.test(normalized);
  if (explicitNavigate || ROUTE_COMMANDS.some((route) => route.aliases.includes(normalized))) {
    const route = findRouteCommand(normalized);
    if (route) {
      return {
        type: 'navigate',
        path: route.path,
        message: `Opening ${route.label}.`,
      };
    }
  }

  return {
    type: 'chat',
    message: raw,
  };
};

export const buildLocalAssistantResponse = (rawText, options = {}) => {
  const {
    cartCount = 0,
    wishlistCount = 0,
  } = options;
  const command = parseAssistantCommand(rawText);

  switch (command.type) {
    case 'help':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ASSISTANT_COMMAND_HINTS.slice(0, 4),
        actions: [],
        local: true,
      };
    case 'close':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: [],
        actions: [{ type: 'close', reason: 'user_requested_close' }],
        autoExecute: true,
        local: true,
      };
    case 'voice':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ['Search for wireless earbuds', 'Open marketplace'],
        actions: [{ type: 'open_voice_assistant', reason: 'voice_requested' }],
        autoExecute: true,
        local: true,
      };
    case 'product':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ['Find cheaper alternatives', 'Open related accessories'],
        actions: [{ type: 'open_product', productId: command.productId, reason: 'product_lookup' }],
        autoExecute: true,
        local: true,
      };
    case 'category':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ['Show top deals', 'Compare top picks'],
        actions: [{ type: 'navigate', path: `/category/${command.slug}`, reason: 'category_navigation' }],
        autoExecute: true,
        local: true,
      };
    case 'navigate':
      return {
        answer: command.path === '/cart' && cartCount === 0
          ? 'Opening your cart. It is empty right now, so I will keep the catalog close by.'
          : command.path === '/wishlist' && wishlistCount === 0
            ? 'Opening your wishlist. It is empty for now, so I can help you curate it next.'
            : command.message,
        actionType: 'assistant',
        suggestions: ['Best deals today', 'Build a smart bundle'],
        actions: [{ type: 'navigate', path: command.path, reason: 'route_navigation' }],
        autoExecute: true,
        local: true,
      };
    case 'search':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ['Compare top results', 'Show cheaper options', 'Build a bundle around this'],
        actions: [{ type: 'search', query: command.query, reason: 'guided_search' }],
        local: false,
      };
    case 'bundle':
      return {
        answer: command.message,
        actionType: 'assistant',
        suggestions: ['Tighten the budget', 'Open bundle page'],
        actions: [],
        local: false,
      };
    case 'chat':
      return null;
    default:
      return null;
  }
};

export const buildAssistantRequestPayload = ({
  message = '',
  selectedMode = 'chat',
  pathname = '/',
  latestProducts = [],
  cartItems = [],
  wishlistItems = [],
} = {}) => {
  const safeProducts = Array.isArray(latestProducts) ? latestProducts : [];
  const productIds = safeProducts
    .map((product) => safeString(product?.id || product?._id || ''))
    .filter(Boolean)
    .slice(0, 4);

  const assistantMode = selectedMode === 'compare' && productIds.length >= 2
    ? 'compare'
    : selectedMode === 'bundle'
      ? 'bundle'
      : 'chat';

  return {
    assistantMode,
    context: {
      route: pathname,
      routeLabel: getAssistantRouteLabel(pathname),
      theme: inferBundleTheme(message, pathname),
      budget: extractBudgetFromText(message),
      maxItems: 6,
      productIds,
      recommendationSignals: {
        recentlyViewed: safeProducts.slice(0, 6).map((product) => ({
          id: safeString(product?.id || product?._id || ''),
          category: safeString(product?.category || ''),
          brand: safeString(product?.brand || ''),
        })),
        searchHistory: [safeString(message)].filter(Boolean),
        cartItems: Array.isArray(cartItems) ? cartItems.length : 0,
        wishlistItems: Array.isArray(wishlistItems) ? wishlistItems.length : 0,
      },
    },
  };
};
