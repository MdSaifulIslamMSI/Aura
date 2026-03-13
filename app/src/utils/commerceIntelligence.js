const clamp = (value, min = 0, max = 100) => Math.min(Math.max(Number(value) || 0, min), max);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseDeliveryDays = (deliveryTime = '') => {
  const text = String(deliveryTime || '').toLowerCase();
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    return (Number(range[1]) + Number(range[2])) / 2;
  }

  const single = text.match(/(\d+)/);
  return single ? Number(single[1]) : 6;
};

const average = (values = []) => {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
};

const getMedianReferencePrice = (priceHistory = [], fallbackPrice = 0) => {
  const prices = (Array.isArray(priceHistory) ? priceHistory : [])
    .map((entry) => toNumber(entry?.price ?? entry?.value ?? entry?.currentPrice, NaN))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (prices.length === 0) return toNumber(fallbackPrice, 0);
  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2 === 1) return prices[middle];
  return (prices[middle - 1] + prices[middle]) / 2;
};

const getTrendDelta = (priceHistory = [], currentPrice = 0, originalPrice = 0) => {
  const prices = (Array.isArray(priceHistory) ? priceHistory : [])
    .map((entry) => toNumber(entry?.price ?? entry?.value ?? entry?.currentPrice, NaN))
    .filter((value) => value > 0);

  if (prices.length >= 2) {
    const first = prices[0];
    const last = prices[prices.length - 1];
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }

  const baseline = toNumber(originalPrice, 0);
  const safeCurrent = toNumber(currentPrice, 0);
  if (baseline > 0) {
    return ((safeCurrent - baseline) / baseline) * 100;
  }

  return 0;
};

const normalizeCategory = (value = '') => String(value || '').trim().toLowerCase();

const categoryRetentionMap = {
  mobiles: 0.58,
  laptops: 0.56,
  electronics: 0.5,
  gaming: 0.54,
  books: 0.66,
  'home-kitchen': 0.42,
  footwear: 0.36,
  "men's-fashion": 0.34,
  "women's-fashion": 0.33,
};

const toneFromScore = (score) => {
  if (score >= 82) return 'emerald';
  if (score >= 68) return 'cyan';
  if (score >= 52) return 'amber';
  return 'rose';
};

const labelFromScore = (score) => {
  if (score >= 82) return 'High Trust';
  if (score >= 68) return 'Stable';
  if (score >= 52) return 'Review Carefully';
  return 'High Attention';
};

export const buildProductTrustGraph = ({ product = {}, reviewsSummary = {}, priceHistory = [] } = {}) => {
  const price = toNumber(product?.price, 0);
  const originalPrice = toNumber(product?.originalPrice, price);
  const rating = toNumber(reviewsSummary?.averageRating, toNumber(product?.rating, 0));
  const ratingCount = toNumber(reviewsSummary?.totalReviews, toNumber(product?.ratingCount, 0));
  const mediaReviews = toNumber(reviewsSummary?.withMediaCount, 0);
  const warranty = String(product?.warranty || '').trim();
  const brand = String(product?.brand || '').trim();
  const stock = toNumber(product?.stock, 0);
  const deliveryDays = parseDeliveryDays(product?.deliveryTime);
  const dealScore = toNumber(product?.dealDna?.score, 60);
  const isDemoCatalog = product?.publishGate?.status === 'dev_only' || product?.provenance?.sourceType === 'dev_seed';

  const medianReferencePrice = getMedianReferencePrice(priceHistory, price);
  const priceGapPct = medianReferencePrice > 0
    ? ((price - medianReferencePrice) / medianReferencePrice) * 100
    : 0;

  const priceFairness = clamp(
    82
    - Math.abs(priceGapPct) * 1.1
    + (toNumber(product?.discountPercentage, 0) * 0.35)
    + (dealScore - 55) * 0.2,
  );
  const reviewConfidence = clamp(
    (rating / 5) * 62
    + Math.min(30, Math.log10(Math.max(1, ratingCount + 1)) * 11)
    + Math.min(10, mediaReviews * 0.8),
  );
  const fulfillmentReliability = clamp(
    (stock > 0 ? 48 : 12)
    + Math.max(0, 28 - (deliveryDays * 2.4))
    + (stock > 10 ? 16 : 8),
  );
  const authenticity = clamp(
    (brand ? 22 : 0)
    + (warranty ? 20 : 0)
    + (isDemoCatalog ? -24 : 0)
    + (product?.provenance?.sourceType && !isDemoCatalog ? 16 : 0)
    + (dealScore * 0.34),
  );
  const protection = clamp(
    (warranty ? 34 : 6)
    + (mediaReviews > 0 ? 16 : 4)
    + (product?.dealDna?.returnRisk?.reasons?.length ? 8 : 18)
    + (ratingCount > 20 ? 20 : 10),
  );

  const overallScore = Math.round(
    (priceFairness * 0.28) +
    (reviewConfidence * 0.24) +
    (fulfillmentReliability * 0.18) +
    (authenticity * 0.17) +
    (protection * 0.13)
  );

  const strengths = [];
  const watchouts = [];

  if (priceFairness >= 75) strengths.push('Price is aligned with current market reference.');
  if (reviewConfidence >= 72) strengths.push('Review density and quality signals are strong.');
  if (fulfillmentReliability >= 72) strengths.push('Delivery and stock posture look dependable.');
  if (authenticity >= 70) strengths.push('Brand, provenance, and warranty signals look solid.');
  if (protection >= 68) strengths.push('Buyer protection signals are above baseline.');

  if (priceFairness < 58) watchouts.push('Price sits outside the normal comfort band for this item.');
  if (reviewConfidence < 55) watchouts.push('Review confidence is still shallow; trust should come from other signals.');
  if (fulfillmentReliability < 55) watchouts.push('Delivery or inventory reliability is weaker than ideal.');
  if (authenticity < 58) watchouts.push('Authenticity signals are incomplete. Verify seller and warranty details.');
  if (protection < 54) watchouts.push('Protection layer is thin. Expect more diligence before checkout.');
  if (isDemoCatalog) watchouts.push('This item is currently sourced from demo inventory rather than a live publish lane.');

  return {
    overallScore,
    label: labelFromScore(overallScore),
    tone: toneFromScore(overallScore),
    headline: overallScore >= 75
      ? 'High-confidence checkout candidate'
      : overallScore >= 60
        ? 'Worth buying with a quick trust check'
        : 'Needs extra verification before purchase',
    summary: medianReferencePrice > 0
      ? `${Math.round(priceGapPct)}% vs median live reference`
      : 'Using live catalog signals only',
    medianReferencePrice,
    priceGapPct,
    metrics: [
      {
        key: 'price',
        label: 'Price Fairness',
        score: Math.round(priceFairness),
        insight: medianReferencePrice > 0
          ? `${Math.abs(Math.round(priceGapPct))}% ${priceGapPct <= 0 ? 'below' : 'above'} live median`
          : 'No history baseline yet',
      },
      {
        key: 'reviews',
        label: 'Review Confidence',
        score: Math.round(reviewConfidence),
        insight: `${rating.toFixed(1)}/5 from ${Math.round(ratingCount).toLocaleString('en-IN')} reviews`,
      },
      {
        key: 'fulfillment',
        label: 'Fulfillment',
        score: Math.round(fulfillmentReliability),
        insight: `${stock > 0 ? 'In stock' : 'Low stock'} with ${deliveryDays}-day delivery profile`,
      },
      {
        key: 'authenticity',
        label: 'Authenticity',
        score: Math.round(authenticity),
        insight: warranty ? 'Warranty and provenance detected' : 'Warranty or provenance is thin',
      },
      {
        key: 'protection',
        label: 'Protection',
        score: Math.round(protection),
        insight: mediaReviews > 0 ? `${mediaReviews} reviews include proof media` : 'Protection relies on standard catalog signals',
      },
    ],
    strengths: strengths.slice(0, 3),
    watchouts: watchouts.slice(0, 3),
  };
};

export const buildLifecycleIntelligence = ({ product = {}, priceHistory = [] } = {}) => {
  const price = toNumber(product?.price, 0);
  const originalPrice = toNumber(product?.originalPrice, price);
  const discount = toNumber(product?.discountPercentage, 0);
  const categoryKey = normalizeCategory(product?.category);
  const deliveryDays = parseDeliveryDays(product?.deliveryTime);
  const trendDelta = getTrendDelta(priceHistory, price, originalPrice);
  const retentionBase = categoryRetentionMap[categoryKey] || 0.45;
  const retention = clamp((retentionBase * 100) + Math.max(-10, Math.min(8, discount * 0.16)), 22, 74);
  const tradeInEstimate = Math.round(price * (retention / 100) * 0.68);
  const resaleLow = Math.round(price * (retention / 100) * 0.9);
  const resaleHigh = Math.round(price * (retention / 100) * 1.06);
  const ninetyDayDepreciation = Math.round(price * (0.08 + (deliveryDays > 4 ? 0.03 : 0.01)));

  let nextBestAction = {
    label: 'Set a price alert',
    reason: 'Price is not obviously at the bottom of its expected range.',
    path: '/price-alerts',
  };

  if (trendDelta <= -8) {
    nextBestAction = {
      label: 'Buy this cycle',
      reason: 'Current pricing is already trending down versus the recent baseline.',
      path: `/product/${product?.id || product?._id || ''}`,
    };
  } else if (tradeInEstimate >= price * 0.22) {
    nextBestAction = {
      label: 'Use trade-in leverage',
      reason: 'Older device credit can materially lower the effective price.',
      path: '/trade-in',
    };
  }

  const upgradeWindow = trendDelta <= -6
    ? 'Upgrade window is open now'
    : trendDelta >= 4
      ? 'Wait for the next pricing dip'
      : 'Watch the next 30-45 days';

  return {
    retention,
    tradeInEstimate,
    resaleLow,
    resaleHigh,
    ninetyDayDepreciation,
    trendDelta,
    upgradeWindow,
    nextBestAction,
    milestones: [
      `Expected 90-day value slide: about Rs ${Math.abs(ninetyDayDepreciation).toLocaleString('en-IN')}`,
      `Likely resale band: Rs ${resaleLow.toLocaleString('en-IN')} - Rs ${resaleHigh.toLocaleString('en-IN')}`,
      `Trade-in leverage today: around Rs ${tradeInEstimate.toLocaleString('en-IN')}`,
    ],
  };
};

export const buildListingSafetyLens = ({ listing = {}, hotspot = null } = {}) => {
  const imagesCount = Array.isArray(listing?.images) ? listing.images.length : 0;
  const isVerifiedSeller = Boolean(listing?.seller?.isVerified);
  const hasEscrow = Boolean(listing?.escrowOptIn);
  const views = toNumber(listing?.views, 0);
  const listingAgeDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(listing?.createdAt || Date.now()).getTime()) / 86400000),
  );
  const hotspotHeat = String(hotspot?.heatLabel || '').toLowerCase();

  const score = Math.round(average([
    hasEscrow ? 92 : 48,
    isVerifiedSeller ? 88 : 56,
    imagesCount >= 3 ? 82 : imagesCount > 0 ? 62 : 30,
    listingAgeDays <= 14 ? 84 : listingAgeDays <= 45 ? 68 : 52,
    views <= 500 ? 74 : 64,
    hotspotHeat === 'blazing' ? 72 : hotspotHeat === 'rising' ? 76 : hotspotHeat === 'balanced' ? 82 : 66,
  ]));

  const highlights = [];
  const watchouts = [];

  if (hasEscrow) highlights.push('Escrow protection is available.');
  if (isVerifiedSeller) highlights.push('Seller identity has been verified.');
  if (imagesCount >= 3) highlights.push('Listing includes enough photo proof to inspect remotely.');
  if (hotspot && hotspot.city === listing?.location?.city) highlights.push('Local demand signal matches this city.');

  if (!hasEscrow) watchouts.push('Move payment only after in-person inspection.');
  if (!isVerifiedSeller) watchouts.push('Seller is not verified yet.');
  if (imagesCount < 2) watchouts.push('Listing has thin image evidence.');
  if (listingAgeDays > 45) watchouts.push('Older listings deserve a freshness check before meetup.');

  return {
    score,
    label: score >= 78 ? 'Safety Mode Ready' : score >= 62 ? 'Proceed With Checks' : 'Manual Verification Needed',
    meetupWindow: '11:00 AM - 6:00 PM',
    highlights: highlights.slice(0, 3),
    watchouts: watchouts.slice(0, 3),
  };
};

export const buildMarketplaceSafetySummary = ({ listings = [], hotspots = [], city = '' } = {}) => {
  const hotspotMap = new Map(
    (Array.isArray(hotspots) ? hotspots : []).map((hotspot) => [
      `${String(hotspot?.city || '').toLowerCase()}::${String(hotspot?.category || '').toLowerCase()}`,
      hotspot,
    ]),
  );

  const scoredListings = (Array.isArray(listings) ? listings : []).map((listing) => {
    const hotspot = hotspotMap.get(
      `${String(listing?.location?.city || '').toLowerCase()}::${String(listing?.category || '').toLowerCase()}`,
    ) || null;
    return buildListingSafetyLens({ listing, hotspot });
  });

  const highSafetyCount = scoredListings.filter((entry) => entry.score >= 78).length;
  const escrowCount = (Array.isArray(listings) ? listings : []).filter((listing) => listing?.escrowOptIn).length;
  const verifiedSellerCount = (Array.isArray(listings) ? listings : []).filter((listing) => listing?.seller?.isVerified).length;

  return {
    averageSafety: Math.round(average(scoredListings.map((entry) => entry.score))),
    highSafetyCount,
    escrowCoverage: listings.length > 0 ? Math.round((escrowCount / listings.length) * 100) : 0,
    verifiedSellerRate: listings.length > 0 ? Math.round((verifiedSellerCount / listings.length) * 100) : 0,
    meetupBrief: city
      ? `Use daylight meetup windows around ${city} and prefer escrow-ready listings first.`
      : 'Prefer public meetup spots and escrow-ready listings first.',
  };
};

export const buildMissionPlan = ({
  goal = '',
  budget = 0,
  deadline = '',
  needsTradeIn = false,
  candidates = [],
  bundle = null,
  marketplaceListings = [],
} = {}) => {
  const compareIds = candidates
    .map((entry) => entry?.product?.id || entry?.product?._id)
    .filter(Boolean)
    .slice(0, 4);

  const topCandidate = candidates[0] || null;
  const readinessScore = Math.round(average([
    topCandidate?.trust?.overallScore || 0,
    bundle?.items?.length ? 80 : 46,
    marketplaceListings.length > 0 ? 72 : 40,
    needsTradeIn ? 76 : 64,
  ]));

  const keyMoves = [
    topCandidate
      ? `Start with ${topCandidate.product.title} because it leads the trust stack.`
      : 'Open a product lane first to establish a primary candidate.',
    bundle?.items?.length
      ? `Use the bundle plan to stay inside roughly Rs ${Math.round(budget).toLocaleString('en-IN')}.`
      : 'Rebuild the bundle after you tighten the mission prompt.',
    needsTradeIn
      ? 'Use trade-in credit before checkout so the cart reflects true cost.'
      : 'Keep trade-in optional unless effective price is still too high.',
  ];

  if (deadline) {
    keyMoves.push(`Work backward from ${deadline} and prioritize fast-delivery items.`);
  }

  const nextActions = [
    compareIds.length >= 2
      ? { label: 'Compare winners', path: `/compare?ids=${compareIds.join(',')}` }
      : null,
    { label: 'Refine with visual search', path: `/visual-search?hints=${encodeURIComponent(goal)}` },
    { label: 'Open local marketplace', path: '/marketplace' },
    needsTradeIn ? { label: 'Use trade-in credit', path: '/trade-in' } : { label: 'Track price drops', path: '/price-alerts' },
  ].filter(Boolean);

  return {
    readinessScore,
    title: goal ? `${goal} mission` : 'Shopping mission',
    compareIds,
    keyMoves: keyMoves.slice(0, 4),
    nextActions,
  };
};
