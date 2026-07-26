const {
    findIndexName,
    toEvidence,
} = require('../scripts/verify_account_center_queries');

describe('account center query verification evidence', () => {
    test('finds an index name in a nested winning plan', () => {
        expect(findIndexName({
            stage: 'FETCH',
            inputStage: {
                stage: 'IXSCAN',
                indexName: 'listing_owner_history',
            },
        })).toBe('listing_owner_history');
    });

    test('reports bounded, privacy-safe execution evidence', () => {
        const evidence = toEvidence('listings', {
            queryPlanner: {
                winningPlan: {
                    inputStage: { indexName: 'listing_owner_history' },
                },
            },
            executionStats: {
                nReturned: 6,
                totalDocsExamined: 6,
                executionTimeMillis: 2,
            },
        });

        expect(evidence).toEqual({
            name: 'listings',
            indexName: 'listing_owner_history',
            nReturned: 6,
            totalDocsExamined: 6,
            examinedPerReturned: 1,
            executionTimeMillis: 2,
        });
        expect(JSON.stringify(evidence)).not.toContain('507f1f77bcf86cd799439299');
    });
});
