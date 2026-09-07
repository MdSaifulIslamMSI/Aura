const SearchEvent = require('../models/SearchEvent');
const RecommendationEvent = require('../models/RecommendationEvent');
const { resolveRetentionSeconds, DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS } = require('../utils/retentionTtl');

const findIndexSpec = (schema, indexName) => schema.indexes().find(
    ([, options]) => options?.name === indexName
);

describe('telemetry retention TTL configuration', () => {
    afterEach(() => {
        delete process.env.SEARCH_EVENT_RETENTION_DAYS;
        delete process.env.RECOMMENDATION_EVENT_RETENTION_DAYS;
    });

    test('SearchEvent carries a 90-day default TTL index on createdAt', () => {
        const [, options] = findIndexSpec(SearchEvent.schema, 'search_event_created_at_ttl');
        expect(options).toMatchObject({
            expireAfterSeconds: 90 * 24 * 60 * 60,
        });
    });

    test('RecommendationEvent carries a 90-day default TTL index on createdAt', () => {
        const [, options] = findIndexSpec(RecommendationEvent.schema, 'recommendation_event_created_at_ttl');
        expect(options).toMatchObject({
            expireAfterSeconds: 90 * 24 * 60 * 60,
        });
    });

    test('resolveRetentionSeconds honours env overrides and clamps outliers', () => {
        process.env.SEARCH_EVENT_RETENTION_DAYS = '30';
        expect(resolveRetentionSeconds({ envVar: 'SEARCH_EVENT_RETENTION_DAYS' })).toBe(30 * 24 * 60 * 60);

        process.env.SEARCH_EVENT_RETENTION_DAYS = 'not-a-number';
        expect(resolveRetentionSeconds({ envVar: 'SEARCH_EVENT_RETENTION_DAYS' })).toBe(DEFAULT_RETENTION_DAYS * 24 * 60 * 60);

        process.env.SEARCH_EVENT_RETENTION_DAYS = '0';
        expect(resolveRetentionSeconds({ envVar: 'SEARCH_EVENT_RETENTION_DAYS' })).toBe(DEFAULT_RETENTION_DAYS * 24 * 60 * 60);

        process.env.SEARCH_EVENT_RETENTION_DAYS = String(MAX_RETENTION_DAYS * 10);
        expect(resolveRetentionSeconds({ envVar: 'SEARCH_EVENT_RETENTION_DAYS' })).toBe(MAX_RETENTION_DAYS * 24 * 60 * 60);
    });
});
