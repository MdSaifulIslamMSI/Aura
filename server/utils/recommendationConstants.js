const RECOMMENDATION_EVENT_TYPES = Object.freeze([
    'product_view',
    'search',
    'category_click',
    'add_to_cart',
    'remove_from_cart',
    'wishlist_add',
    'wishlist_remove',
    'purchase',
    'rating',
    'recommendation_impression',
    'recommendation_click',
    'assistant_recommendation_request',
]);

const RECOMMENDATION_SOURCE_PAGES = Object.freeze([
    'home',
    'product_detail',
    'cart',
    'search',
    'checkout',
    'dashboard',
    'assistant',
]);

const EVENT_WEIGHTS = Object.freeze({
    product_view: 1,
    search: 1.5,
    category_click: 1,
    wishlist_add: 3,
    add_to_cart: 5,
    purchase: 10,
    recommendation_click: 4,
});

const RECOMMENDATION_REASONS = Object.freeze({
    similarCategory: 'Similar category',
    sameBrand: 'Same brand',
    similarPrice: 'Similar price range',
    relatedProduct: 'Related to this product',
    popularSimilar: 'Popular similar product',
    viewedSimilar: 'Because you viewed similar products',
    popularCategory: 'Popular in this category',
    boughtTogether: 'Frequently bought with your cart items',
    recentInterest: 'Matches your recent interest',
    topRated: 'Top-rated product',
    trending: 'Trending this week',
    searchBased: 'Based on your search',
    cartAddon: 'Good add-on for your cart',
    newArrival: 'New arrival in your preferred category',
    coldStart: 'High-confidence catalog pick',
});

const SOURCE_LABELS = Object.freeze({
    content: 'content_based',
    collaborative: 'collaborative',
    popularity: 'popularity',
    personalized: 'personalized',
    cart: 'cart_add_on',
    recent: 'recently_viewed',
    search: 'search_based',
    assistant: 'assistant_recommendation',
    fallback: 'fallback',
});

const ACCESSORY_KEYWORDS_BY_CATEGORY = Object.freeze({
    mobiles: ['cover', 'case', 'charger', 'cable', 'earbuds', 'screen protector', 'adapter', 'power bank'],
    mobile: ['cover', 'case', 'charger', 'cable', 'earbuds', 'screen protector', 'adapter', 'power bank'],
    smartphones: ['cover', 'case', 'charger', 'cable', 'earbuds', 'screen protector', 'adapter', 'power bank'],
    laptops: ['mouse', 'keyboard', 'laptop bag', 'cooling pad', 'adapter', 'monitor', 'stand'],
    laptop: ['mouse', 'keyboard', 'laptop bag', 'cooling pad', 'adapter', 'monitor', 'stand'],
    footwear: ['socks', 'shoe cleaner', 'sports bag', 'insoles'],
    shoes: ['socks', 'shoe cleaner', 'sports bag', 'insoles'],
    fashion: ['belt', 'wallet', 'watch', 'bag', 'accessory'],
    "men's-fashion": ['belt', 'wallet', 'watch', 'bag', 'accessory'],
    "women's-fashion": ['bag', 'watch', 'accessory', 'scarf', 'jewellery'],
    electronics: ['cable', 'adapter', 'case', 'stand', 'battery', 'cleaning kit'],
    gaming: ['controller', 'headset', 'keyboard', 'mouse', 'chair'],
});

const clampRecommendationLimit = (value, fallback = 8, max = 24) => (
    Math.min(Math.max(Number(value) || fallback, 1), max)
);

module.exports = {
    ACCESSORY_KEYWORDS_BY_CATEGORY,
    EVENT_WEIGHTS,
    RECOMMENDATION_EVENT_TYPES,
    RECOMMENDATION_REASONS,
    RECOMMENDATION_SOURCE_PAGES,
    SOURCE_LABELS,
    clampRecommendationLimit,
};
