const CATEGORY_ROUTES = [
    { aliases: ['mobiles', 'mobile', 'phone', 'smartphone', 'phones', 'mobiles dikhao'], slug: 'mobiles', label: 'Mobiles' },
    { aliases: ['laptops', 'laptop', 'notebook', 'macbook'], slug: 'laptops', label: 'Laptops' },
    { aliases: ['electronics', 'electronic', 'gadgets', 'gadget'], slug: 'electronics', label: 'Electronics' },
    { aliases: ['mens fashion', "men's fashion", 'mens', 'men fashion'], slug: "men's-fashion", label: "Men's Fashion" },
    { aliases: ['womens fashion', "women's fashion", 'womens', 'women fashion'], slug: "women's-fashion", label: "Women's Fashion" },
    { aliases: ['home kitchen', 'home', 'kitchen'], slug: 'home-kitchen', label: 'Home & Kitchen' },
    { aliases: ['gaming', 'games', 'console'], slug: 'gaming', label: 'Gaming' },
    { aliases: ['books', 'book'], slug: 'books', label: 'Books' },
    { aliases: ['footwear', 'shoes', 'shoe'], slug: 'footwear', label: 'Footwear' },
];

const ROUTE_COMMANDS = [
    { aliases: ['home', 'homepage', 'ghar'], path: '/', label: 'Home' },
    { aliases: ['marketplace', 'market place', 'market'], path: '/marketplace', label: 'Marketplace' },
    { aliases: ['cart', 'bag', 'cart kholo', 'cart open'], path: '/cart', label: 'Cart' },
    { aliases: ['wishlist', 'favorites', 'favourites'], path: '/wishlist', label: 'Wishlist' },
    { aliases: ['orders', 'my orders', 'order dikhao'], path: '/orders', label: 'Orders' },
    { aliases: ['profile', 'account'], path: '/profile', label: 'Profile' },
    { aliases: ['sell', 'sell item', 'seller'], path: '/sell', label: 'Sell' },
    { aliases: ['bundles', 'smart bundles', 'bundle'], path: '/bundles', label: 'Bundles' },
    { aliases: ['compare', 'ai compare', 'comparison'], path: '/compare', label: 'AI Compare' },
    { aliases: ['visual search', 'camera search', 'image search'], path: '/visual-search', label: 'Visual Search' },
    { aliases: ['deals', 'offers'], path: '/deals', label: 'Deals' },
    { aliases: ['trending'], path: '/trending', label: 'Trending' },
    { aliases: ['new arrivals', 'latest'], path: '/new-arrivals', label: 'New Arrivals' },
    { aliases: ['checkout'], path: '/checkout', label: 'Checkout' },
];

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const normalizeText = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

const interpretVoiceCommand = (rawText = '') => {
    const raw = safeString(rawText);
    if (!raw) {
        return {
            answer: 'Say a command like search for iPhone 15, open cart, or show laptops.',
            actions: [],
            followUps: ['Search for phones', 'Open marketplace', 'Show bundles'],
        };
    }

    const normalized = normalizeText(raw);
    if (/\b(help|commands|what can you do|kya kar sakte ho)\b/.test(normalized)) {
        return {
            answer: 'You can ask me to search products, open pages, compare products, or show a category.',
            actions: [],
            followUps: ['Search for iPhone 15', 'Open marketplace', 'Show mobiles category'],
        };
    }

    if (/\b(close|exit|cancel|stop|band karo)\b/.test(normalized)) {
        return {
            answer: 'Closing voice assistant.',
            actions: [{ type: 'close' }],
            followUps: [],
        };
    }

    const productIdMatch = normalized.match(/\b(?:open|show)\s+(?:product|item)\s+([a-z0-9._-]{4,})\b/);
    if (productIdMatch) {
        return {
            answer: `Opening product ${productIdMatch[1]}.`,
            actions: [{ type: 'open_product', productId: productIdMatch[1] }],
            followUps: [],
        };
    }

    const searchMatch = raw.match(/^\s*(?:search(?:\s+for)?|find|look\s+for|show\s+me|buy|mujhe|dikhao)\s+(.+)$/i);
    if (searchMatch?.[1]?.trim()) {
        const query = safeString(searchMatch[1]);
        return {
            answer: `Searching for ${query}.`,
            actions: [{ type: 'search', query }],
            followUps: ['Compare top results', 'Show cheaper options', 'Open visual search'],
        };
    }

    const categoryIntent = /\b(category|section|show|dikhao|open)\b/.test(normalized)
        ? findCategoryCommand(normalized)
        : null;
    if (categoryIntent) {
        return {
            answer: `Opening ${categoryIntent.label} category.`,
            actions: [{ type: 'navigate', path: `/category/${categoryIntent.slug}` }],
            followUps: [],
        };
    }

    const routeIntent = findRouteCommand(normalized);
    if (routeIntent) {
        return {
            answer: `Opening ${routeIntent.label}.`,
            actions: [{ type: 'navigate', path: routeIntent.path }],
            followUps: [],
        };
    }

    if (raw.length >= 2) {
        return {
            answer: `Searching for ${raw}.`,
            actions: [{ type: 'search', query: raw }],
            followUps: ['Compare top results', 'Filter by budget', 'Show trending picks'],
        };
    }

    return {
        answer: 'I could not understand that voice command.',
        actions: [],
        followUps: ['Search for mobiles', 'Open cart', 'Show deals'],
    };
};

module.exports = {
    interpretVoiceCommand,
};
