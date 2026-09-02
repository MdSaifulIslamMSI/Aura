import { describe, expect, it } from 'vitest';
import {
    buildLifecycleIntelligence,
    buildListingSafetyLens,
    buildMarketplaceSafetySummary,
    buildMissionPlan,
    buildProductTrustGraph,
    parseDeliveryDays,
} from './commerceIntelligence';

const strongProduct = {
    id: 'p1',
    price: 20000,
    originalPrice: 24000,
    discountPercentage: 15,
    rating: 4.5,
    ratingCount: 1200,
    stock: 30,
    brand: 'Samsung',
    warranty: '1 year manufacturer warranty',
    deliveryTime: '2-3 days',
};

describe('parseDeliveryDays', () => {
    it('averages day ranges', () => {
        expect(parseDeliveryDays('2-3 days')).toBe(2.5);
        expect(parseDeliveryDays('10 - 20 days')).toBe(15);
    });

    it('parses single day mentions', () => {
        expect(parseDeliveryDays('Arriving in 5 days')).toBe(5);
    });

    it('falls back to 6 days when nothing parseable is present', () => {
        expect(parseDeliveryDays('')).toBe(6);
        expect(parseDeliveryDays('soon')).toBe(6);
        expect(parseDeliveryDays(undefined)).toBe(6);
    });
});

describe('buildProductTrustGraph', () => {
    it('derives a bounded overall score with the median price reference', () => {
        const graph = buildProductTrustGraph({
            product: strongProduct,
            reviewsSummary: { averageRating: 4.5, totalReviews: 1200, withMediaCount: 40 },
            priceHistory: [{ price: 20500 }, { price: 21000 }],
        });

        expect(graph.overallScore).toBeGreaterThanOrEqual(0);
        expect(graph.overallScore).toBeLessThanOrEqual(100);
        expect(graph.label).toBe(
            graph.overallScore >= 82 ? 'High Trust'
                : graph.overallScore >= 68 ? 'Stable'
                    : graph.overallScore >= 52 ? 'Review Carefully'
                        : 'High Attention',
        );
        expect(graph.metrics).toHaveLength(5);
        expect(graph.metrics[0].key).toBe('price');
        expect(graph.metrics[1].key).toBe('reviews');
        expect(graph.medianReferencePrice).toBe(20750);
        expect(graph.summary).toContain('% vs median live reference');
    });

    it('flags demo-catalog provenance as a watchout', () => {
        const graph = buildProductTrustGraph({
            product: { ...strongProduct, publishGate: { status: 'dev_only' } },
        });

        expect(graph.watchouts).toContain('This item is currently sourced from demo inventory rather than a live publish lane.');
    });

    it('scores an anonymous, out-of-stock product lower than a strong one', () => {
        const weak = buildProductTrustGraph({
            product: { price: 50000, stock: 0, deliveryTime: '9-10 days' },
        });
        const strong = buildProductTrustGraph({ product: strongProduct });

        expect(weak.overallScore).toBeLessThan(strong.overallScore);
    });
});

describe('buildLifecycleIntelligence', () => {
    it('computes the mobiles retention band and trade-in estimate from category', () => {
        const intel = buildLifecycleIntelligence({
            product: { price: 20000, category: 'Mobiles', discountPercentage: 0 },
            priceHistory: [{ price: 20000 }, { price: 18400 }],
        });

        // retention = 58 (mobiles) clamped to [22, 74]
        expect(intel.retention).toBeCloseTo(58, 6);
        expect(intel.tradeInEstimate).toBe(Math.round(20000 * 0.58 * 0.68));
        expect(intel.resaleLow).toBe(Math.round(20000 * 0.58 * 0.9));
        expect(intel.resaleHigh).toBe(Math.round(20000 * 0.58 * 1.06));
    });

    it('recommends buying this cycle when prices trend down 8% or more', () => {
        const intel = buildLifecycleIntelligence({
            product: { price: 18400, category: 'mobiles' },
            priceHistory: [{ price: 20000 }, { price: 18400 }],
        });

        expect(intel.trendDelta).toBeCloseTo(-8, 5);
        expect(intel.nextBestAction.label).toBe('Buy this cycle');
        expect(intel.upgradeWindow).toBe('Upgrade window is open now');
    });

    it('uses a 45% fallback retention for unknown categories', () => {
        const intel = buildLifecycleIntelligence({ product: { price: 10000, category: 'obscuria' } });
        expect(intel.retention).toBe(45);
    });
});

describe('buildListingSafetyLens', () => {
    const freshListing = () => ({ createdAt: new Date().toISOString(), views: 100 });

    it('marks escrow-backed, verified listings with photo proof as safety-ready', () => {
        const lens = buildListingSafetyLens({
            listing: {
                ...freshListing(),
                escrowOptIn: true,
                seller: { isVerified: true },
                // Only 2 images: highlights are capped at 3, so keeping imagery
                // brief lets the city-match highlight survive the slice.
                images: ['a', 'b'],
                location: { city: 'Bengaluru' },
            },
            hotspot: { city: 'Bengaluru', heatLabel: 'balanced' },
        });

        expect(lens.label).toBe('Safety Mode Ready');
        expect(lens.highlights).toContain('Escrow protection is available.');
        expect(lens.highlights).toContain('Local demand signal matches this city.');
        expect(lens.watchouts).toEqual([]);
    });

    it('lists watchouts for unverified, escrow-less listings with thin imagery', () => {
        const lens = buildListingSafetyLens({ listing: { ...freshListing(), images: [] } });

        expect(lens.watchouts).toContain('Move payment only after in-person inspection.');
        expect(lens.watchouts).toContain('Seller is not verified yet.');
        expect(lens.watchouts).toContain('Listing has thin image evidence.');
        expect(lens.label).not.toBe('Safety Mode Ready');
    });
});

describe('buildMarketplaceSafetySummary', () => {
    it('aggregates escrow coverage, verified rate, and a city-aware meetup brief', () => {
        const summary = buildMarketplaceSafetySummary({
            listings: [
                { escrowOptIn: true, seller: { isVerified: true }, images: ['a'], location: { city: 'Bengaluru' }, category: 'mobiles', createdAt: new Date().toISOString() },
                { escrowOptIn: false, seller: { isVerified: false }, images: [], location: { city: 'Bengaluru' }, category: 'mobiles', createdAt: new Date().toISOString() },
            ],
            hotspots: [],
            city: 'Bengaluru',
        });

        expect(summary.escrowCoverage).toBe(50);
        expect(summary.verifiedSellerRate).toBe(50);
        expect(summary.highSafetyCount).toBeLessThanOrEqual(2);
        expect(summary.meetupBrief).toContain('Bengaluru');
    });

    it('falls back to a generic meetup brief without a city', () => {
        expect(buildMarketplaceSafetySummary({ listings: [] }).meetupBrief).toContain('Prefer public meetup spots');
        expect(buildMarketplaceSafetySummary({ listings: [] }).escrowCoverage).toBe(0);
    });
});

describe('buildMissionPlan', () => {
    it('builds compare actions, key moves, and a titled plan', () => {
        const plan = buildMissionPlan({
            goal: 'Upgrade phone',
            budget: 45000,
            deadline: '2025-12-01',
            needsTradeIn: true,
            candidates: [
                { product: { id: 'p1', title: 'Galaxy S' }, trust: { overallScore: 90 } },
                { product: { id: 'p2', title: 'Pixel X' }, trust: { overallScore: 80 } },
            ],
            bundle: { items: [{ id: 'b1' }] },
            marketplaceListings: [{ id: 'l1' }],
        });

        expect(plan.title).toBe('Upgrade phone mission');
        expect(plan.compareIds).toEqual(['p1', 'p2']);
        expect(plan.keyMoves[0]).toContain('Start with Galaxy S');
        expect(plan.keyMoves.some((move) => move.includes('2025-12-01'))).toBe(true);
        expect(plan.nextActions[0]).toEqual({ label: 'Compare winners', path: '/compare?ids=p1,p2' });
        expect(plan.nextActions.some((action) => action.path === '/trade-in')).toBe(true);
    });

    it('degrades gracefully without candidates, bundle, or deadline', () => {
        const plan = buildMissionPlan({});

        expect(plan.title).toBe('Shopping mission');
        expect(plan.compareIds).toEqual([]);
        expect(plan.keyMoves[0]).toContain('Open a product lane first');
        expect(plan.nextActions.some((action) => action.path === '/price-alerts')).toBe(true);
        expect(plan.nextActions.some((action) => action.path === '/compare')).toBe(false);
    });
});
