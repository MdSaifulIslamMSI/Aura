const {
    collectWinningIndexNames,
    flattenWinningPlanStages,
    queryShape,
    summarizeIndexUsageStats,
} = require('../scripts/audit_mongo_storage');

describe('mongo storage audit evidence helpers', () => {
    test('summarizes unused non-id index usage without treating _id as removable evidence', () => {
        const summary = summarizeIndexUsageStats('products', [
            { name: '_id_', accesses: { ops: 0, since: '2026-01-01T00:00:00.000Z' } },
            { name: 'category_1', accesses: { ops: 12, since: '2026-01-01T00:00:00.000Z' } },
            { name: 'legacy_unused_1', accesses: { ops: 0, since: '2026-01-01T00:00:00.000Z' } },
        ]);

        expect(summary).toEqual(expect.objectContaining({
            name: 'products',
            indexCountWithUsage: 3,
            totalIndexOps: 12,
            unusedNonIdIndexCount: 1,
            unusedNonIdIndexNames: ['legacy_unused_1'],
        }));
        expect(summary.unusedNonIdIndexNames).not.toContain('_id_');
    });

    test('extracts stage and winning index names from nested query plans', () => {
        const plan = {
            stage: 'FETCH',
            inputStage: {
                stage: 'IXSCAN',
                indexName: 'isPublished_1_catalogVersion_1_category_1_price_1',
            },
        };

        expect(flattenWinningPlanStages(plan)).toEqual(['FETCH', 'IXSCAN']);
        expect([...collectWinningIndexNames(plan)]).toEqual([
            'isPublished_1_catalogVersion_1_category_1_price_1',
        ]);
    });

    test('redacts query constants from reported query shapes', () => {
        expect(queryShape({
            filter: {
                email: 'person@example.test',
                createdAt: { $gte: new Date('2026-01-01T00:00:00.000Z') },
            },
            sort: { createdAt: -1 },
        })).toEqual({
            filter: {
                createdAt: { $gte: '?' },
                email: '?',
            },
            sort: { createdAt: -1 },
        });
    });
});
