import { defineMessages } from 'react-intl';

export const assistantIntentMessages = defineMessages({
    categoryMobiles: {
        id: 'assistant.intent.category.mobiles',
        defaultMessage: 'Mobiles',
    },
    categoryLaptops: {
        id: 'assistant.intent.category.laptops',
        defaultMessage: 'Laptops',
    },
    categoryElectronics: {
        id: 'assistant.intent.category.electronics',
        defaultMessage: 'Electronics',
    },
    categoryGaming: {
        id: 'assistant.intent.category.gaming',
        defaultMessage: 'Gaming',
    },
    categoryBooks: {
        id: 'assistant.intent.category.books',
        defaultMessage: 'Books',
    },
    navHome: {
        id: 'assistant.intent.navigation.home',
        defaultMessage: 'Home',
    },
    navMarketplace: {
        id: 'assistant.intent.navigation.marketplace',
        defaultMessage: 'Marketplace',
    },
    navCart: {
        id: 'assistant.intent.navigation.cart',
        defaultMessage: 'Cart',
    },
    navWishlist: {
        id: 'assistant.intent.navigation.wishlist',
        defaultMessage: 'Wishlist',
    },
    navOrders: {
        id: 'assistant.intent.navigation.orders',
        defaultMessage: 'Orders',
    },
    navProfile: {
        id: 'assistant.intent.navigation.profile',
        defaultMessage: 'Profile',
    },
    navSell: {
        id: 'assistant.intent.navigation.sell',
        defaultMessage: 'Sell',
    },
    navBundles: {
        id: 'assistant.intent.navigation.bundles',
        defaultMessage: 'Bundles',
    },
    navCompare: {
        id: 'assistant.intent.navigation.aiCompare',
        defaultMessage: 'AI Compare',
    },
    navVisualSearch: {
        id: 'assistant.intent.navigation.visualSearch',
        defaultMessage: 'Visual Search',
    },
    navDeals: {
        id: 'assistant.intent.navigation.deals',
        defaultMessage: 'Deals',
    },
    navTrending: {
        id: 'assistant.intent.navigation.trending',
        defaultMessage: 'Trending',
    },
    navNewArrivals: {
        id: 'assistant.intent.navigation.newArrivals',
        defaultMessage: 'New Arrivals',
    },
    navCheckout: {
        id: 'assistant.intent.navigation.checkout',
        defaultMessage: 'Checkout',
    },
    browseCategory: {
        id: 'assistant.intent.action.browseCategory',
        defaultMessage: 'Browse {category}',
    },
    closeVoiceAssistant: {
        id: 'assistant.intent.voice.close',
        defaultMessage: 'Closing voice assistant.',
    },
    openingProduct: {
        id: 'assistant.intent.voice.openingProduct',
        defaultMessage: 'Opening product {productId}.',
    },
    openingPage: {
        id: 'assistant.intent.voice.openingPage',
        defaultMessage: 'Opening {page}.',
    },
    fallbackPage: {
        id: 'assistant.intent.voice.fallbackPage',
        defaultMessage: 'that page',
    },
    showResultsFor: {
        id: 'assistant.intent.voice.showResultsFor',
        defaultMessage: 'Show results for {query}.',
    },
    helpExamples: {
        id: 'assistant.intent.voice.helpExamples',
        defaultMessage: 'Try saying search for iPhone fifteen, open cart, show laptops category, or open marketplace.',
    },
    unknownCommand: {
        id: 'assistant.intent.voice.unknownCommand',
        defaultMessage: 'I could not understand that. Say help for examples.',
    },
});

const CATEGORY_ALIASES = [
    { aliases: ['mobiles', 'mobile', 'phone', 'smartphone', 'iphone', 'android'], value: 'mobiles', message: assistantIntentMessages.categoryMobiles },
    { aliases: ['laptops', 'laptop', 'notebook', 'macbook'], value: 'laptops', message: assistantIntentMessages.categoryLaptops },
    { aliases: ['electronics', 'electronic', 'gadgets', 'gadget'], value: 'electronics', message: assistantIntentMessages.categoryElectronics },
    { aliases: ['gaming', 'games', 'console'], value: 'gaming', message: assistantIntentMessages.categoryGaming },
    { aliases: ['books', 'book'], value: 'books', message: assistantIntentMessages.categoryBooks },
];

const NAVIGATION_TARGETS = [
    { aliases: ['home', 'homepage'], page: 'home', path: '/', message: assistantIntentMessages.navHome },
    { aliases: ['marketplace', 'market place'], page: 'marketplace', path: '/marketplace', message: assistantIntentMessages.navMarketplace },
    { aliases: ['cart', 'bag', 'basket'], page: 'cart', path: '/cart', message: assistantIntentMessages.navCart },
    { aliases: ['wishlist', 'favorites', 'favourites'], page: 'wishlist', path: '/wishlist', message: assistantIntentMessages.navWishlist },
    { aliases: ['orders', 'my orders', 'order history'], page: 'orders', path: '/orders', message: assistantIntentMessages.navOrders },
    { aliases: ['profile', 'account'], page: 'profile', path: '/profile', message: assistantIntentMessages.navProfile },
    { aliases: ['sell', 'sell item'], page: 'sell', path: '/sell', message: assistantIntentMessages.navSell },
    { aliases: ['bundles', 'smart bundles'], page: 'bundles', path: '/bundles', message: assistantIntentMessages.navBundles },
    { aliases: ['compare', 'ai compare'], page: 'compare', path: '/compare', message: assistantIntentMessages.navCompare },
    { aliases: ['visual search', 'camera search'], page: 'visual_search', path: '/visual-search', message: assistantIntentMessages.navVisualSearch },
    { aliases: ['deals', 'offers'], page: 'deals', path: '/deals', message: assistantIntentMessages.navDeals },
    { aliases: ['trending'], page: 'trending', path: '/trending', message: assistantIntentMessages.navTrending },
    { aliases: ['new arrivals', 'latest'], page: 'new_arrivals', path: '/new-arrivals', message: assistantIntentMessages.navNewArrivals },
    { aliases: ['checkout'], page: 'checkout', path: '/checkout', message: assistantIntentMessages.navCheckout },
];

const safeString = (value = '') => String(value ?? '').trim();

const interpolateDefaultMessage = (template = '', values = {}) => safeString(template).replace(/\{(\w+)\}/g, (_match, key) => (
    values[key] === undefined || values[key] === null ? '' : String(values[key])
));

const formatAssistantIntentMessage = (formatMessage, descriptor, values = {}) => {
    if (!descriptor) return '';

    if (typeof formatMessage === 'function') {
        try {
            return formatMessage(descriptor, values);
        } catch {
            return interpolateDefaultMessage(descriptor.defaultMessage, values);
        }
    }

    return interpolateDefaultMessage(descriptor.defaultMessage, values);
};

export const normalizeAssistantText = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const findAssistantCategory = (value = '') => {
    const normalized = normalizeAssistantText(value);
    return CATEGORY_ALIASES.find((entry) => entry.aliases.some((alias) => normalized.includes(alias))) || null;
};

export const findAssistantNavigationTarget = (value = '') => {
    const normalized = normalizeAssistantText(value);
    return NAVIGATION_TARGETS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias))) || null;
};

export const extractAssistantBudget = (value = '') => {
    const normalized = safeString(value);
    const patterns = [
        /\b(?:under|below|less than|max|within|around|about)\s+(\d[\d,]*)(k)?\b/i,
        /\b(?:rs|inr)\s*(\d[\d,]*)(k)?\b/i,
        /\b(\d[\d,]*)\s*(k)\b(?:\s*(?:price|budget))?/i,
        /\b(\d[\d,]*)\b\s*(?:price|budget)\b/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        const base = Number(String(match[1] || '').replace(/,/g, '')) || 0;
        if (base <= 0) continue;
        return match[2] ? base * 1000 : base;
    }

    return 0;
};

export const parseClientAssistantIntent = (value = '', options = {}) => {
    const formatMessage = options?.formatMessage;
    const raw = safeString(value);
    if (!raw) {
        return {
            intent: 'general_knowledge',
            confidence: 0,
            entities: {},
        };
    }

    const normalized = normalizeAssistantText(raw);
    const category = findAssistantCategory(raw);
    const pageTarget = findAssistantNavigationTarget(raw);
    const maxPrice = extractAssistantBudget(raw);
    const ratingMatch = normalized.match(/\brating\s*([1-5](?:\.\d)?)\+?\b/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
    const inStock = /\bin stock|available now|ready stock\b/.test(normalized);
    const deliveryTime = /\bfast delivery|quick delivery|same day|one day\b/.test(normalized) ? '1-2 days' : undefined;
    const productId = raw.match(/\b(?:product|item)\s+([a-z0-9._-]{3,})\b/i)?.[1] || '';
    const browseCategory = Boolean(category)
        && /\b(open|browse|go to|take me to)\b/.test(normalized)
        && !/\b(search|find|show me|best|cheap|affordable|under|below|within|price)\b/.test(normalized);
    const cartOperation = /\b(add|buy|put in cart|place in cart)\b/.test(normalized)
        ? 'add'
        : /\b(remove|delete|take out)\b/.test(normalized)
            ? 'remove'
            : /\b(show|view|open)\b.*\b(cart|bag)\b/.test(normalized)
                ? 'view'
                : '';

    const cleanedQuery = raw
        .replace(/\b(?:under|below|less than|max|within)\s+\d{1,3}k?\b/gi, ' ')
        .replace(/\brating\s*[1-5](?:\.\d)?\+?\b/gi, ' ')
        .replace(/\bfast delivery|quick delivery|same day|one day|in stock|available now|ready stock\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (/\b(help|commands|what can you do)\b/.test(normalized)) {
        return {
            intent: 'general_knowledge',
            confidence: 0.9,
            entities: {},
            action: {
                type: 'help',
            },
        };
    }

    if (/\b(close|exit|cancel|stop)\b/.test(normalized)) {
        return {
            intent: 'navigation',
            confidence: 0.95,
            entities: {
                page: 'close',
            },
            action: {
                type: 'close',
            },
        };
    }

    if (/\b(checkout|pay now|place order)\b/.test(normalized) || pageTarget?.page === 'checkout') {
        return {
            intent: 'checkout',
            confidence: 0.95,
            entities: {
                page: 'checkout',
            },
        };
    }

    if (/\b(track|refund|return|replace|replacement|support|issue|problem|complaint|warranty)\b/.test(normalized)) {
        return {
            intent: 'support',
            confidence: 0.88,
            entities: {},
        };
    }

    if (cartOperation && cartOperation !== 'view') {
        return {
            intent: 'cart_action',
            confidence: productId ? 0.92 : 0.78,
            entities: {
                productId,
                operation: cartOperation,
            },
        };
    }

    if (browseCategory && category?.value) {
        return {
            intent: 'navigation',
            confidence: 0.82,
            entities: {
                page: 'category',
                category: category.value,
            },
            action: {
                type: 'navigate',
                path: `/category/${category.value}`,
                label: formatAssistantIntentMessage(formatMessage, assistantIntentMessages.browseCategory, {
                    category: formatAssistantIntentMessage(formatMessage, category.message),
                }),
                params: {
                    category: category.value,
                },
            },
        };
    }

    if (pageTarget) {
        return {
            intent: 'navigation',
            confidence: 0.9,
            entities: {
                page: pageTarget.page,
            },
            action: {
                type: 'navigate',
                path: pageTarget.path,
                label: formatAssistantIntentMessage(formatMessage, pageTarget.message),
            },
        };
    }

    const hasSearchSignals = Boolean(
        category
        || maxPrice
        || rating
        || inStock
        || deliveryTime
        || /\b(search|find|look for|show me|buy|need|want|best|cheap|affordable|compare|vs|versus)\b/.test(normalized)
    );

    if (productId && /\b(open|show|view|details)\b/.test(normalized)) {
        return {
            intent: 'product_selection',
            confidence: 0.93,
            entities: {
                productId,
            },
            action: {
                type: 'open_product',
                productId,
            },
        };
    }

    if (hasSearchSignals) {
        return {
            intent: 'product_search',
            confidence: 0.84,
            entities: {
                query: cleanedQuery || raw,
                category: category?.value,
                maxPrice: maxPrice || undefined,
                rating,
                inStock: inStock ? 'true' : undefined,
                deliveryTime,
            },
            action: {
                type: 'search',
                query: cleanedQuery || raw,
            },
        };
    }

    return {
        intent: 'general_knowledge',
        confidence: 0.55,
        entities: {},
    };
};

export const parseSemanticSearchIntent = (value = '') => {
    const raw = safeString(value);
    if (!raw) return null;

    const parsed = parseClientAssistantIntent(raw);
    if (parsed.intent !== 'product_search') return null;

    return {
        name: raw,
        query: parsed.entities.query || raw,
        category: parsed.entities.category,
        maxPrice: parsed.entities.maxPrice,
        rating: parsed.entities.rating,
        inStock: parsed.entities.inStock,
        deliveryTime: parsed.entities.deliveryTime,
    };
};

export const buildLocalVoiceCommand = (value = '', options = {}) => {
    const raw = safeString(value);
    const formatMessage = options?.formatMessage;
    const parsed = parseClientAssistantIntent(raw, { formatMessage });

    if (parsed.action?.type === 'close') {
        return {
            type: 'close',
            message: formatAssistantIntentMessage(formatMessage, assistantIntentMessages.closeVoiceAssistant),
        };
    }

    if (parsed.action?.type === 'open_product' && parsed.action.productId) {
        return {
            type: 'product',
            productId: parsed.action.productId,
            message: formatAssistantIntentMessage(formatMessage, assistantIntentMessages.openingProduct, {
                productId: parsed.action.productId,
            }),
        };
    }

    if (parsed.intent === 'navigation' && parsed.action?.path) {
        return {
            type: 'navigate',
            path: parsed.action.path,
            message: formatAssistantIntentMessage(formatMessage, assistantIntentMessages.openingPage, {
                page: parsed.action.label || formatAssistantIntentMessage(formatMessage, assistantIntentMessages.fallbackPage),
            }),
        };
    }

    if (parsed.intent === 'product_search' && parsed.entities.query) {
        return {
            type: 'search',
            query: parsed.entities.query,
            message: formatAssistantIntentMessage(formatMessage, assistantIntentMessages.showResultsFor, {
                query: parsed.entities.query,
            }),
        };
    }

    return {
        type: parsed.intent === 'general_knowledge' ? 'help' : 'unknown',
        message: parsed.intent === 'general_knowledge'
            ? formatAssistantIntentMessage(formatMessage, assistantIntentMessages.helpExamples)
            : formatAssistantIntentMessage(formatMessage, assistantIntentMessages.unknownCommand),
    };
};
