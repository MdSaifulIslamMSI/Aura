const {
    EXPECTED_INDEXES,
    assertApplyAuthorization,
    pendingVersionFilter,
    runAccountCenterMigration,
} = require('../services/accountCenterMigrationService');

const APPLY_OPTIONS = Object.freeze({
    mode: 'apply',
    execute: true,
    runId: 'account-center-staging-001',
    approvedBy: 'release-operator',
    ticket: 'CHANGE-001',
    backupEvidence: 'backup://staging/account-center-001',
    rollbackSha: 'a'.repeat(40),
    batchSize: 2,
    delayMs: 1,
});

const createStore = ({ pendingIds = [], existingRun = null, indexes = EXPECTED_INDEXES } = {}) => {
    let run = existingRun;
    let pending = [...pendingIds];
    const store = {
        countPending: jest.fn(async () => pending.length),
        getBatch: jest.fn(async ({ afterId, limit }) => pending
            .filter((id) => !afterId || id > afterId)
            .slice(0, limit)
            .map((_id) => ({ _id }))),
        updateBatch: jest.fn(async (ids) => {
            const matchedCount = pending.filter((id) => ids.includes(id)).length;
            pending = pending.filter((id) => !ids.includes(id));
            return { matchedCount, modifiedCount: matchedCount };
        }),
        ensureIndexes: jest.fn(async () => undefined),
        listIndexNames: jest.fn(async () => [...indexes]),
        getRun: jest.fn(async () => run),
        createRun: jest.fn(async (payload) => {
            run = { ...payload };
            return run;
        }),
        updateRun: jest.fn(async (runId, update) => {
            run = { ...run, ...update, runId };
            return run;
        }),
    };
    return store;
};

describe('account center schema migration', () => {
    test('audit mode is additive and completes a previously interrupted audit record', async () => {
        const store = createStore({
            pendingIds: ['001', '002'],
            existingRun: {
                runId: 'account-center-audit-001',
                migrationId: 'account-center-v2-schema-2026-07',
                mode: 'audit',
                status: 'running',
                pendingBefore: 2,
            },
        });

        const evidence = await runAccountCenterMigration({
            mode: 'audit',
            runId: 'account-center-audit-001',
        }, { store });

        expect(evidence).toMatchObject({
            mode: 'audit',
            status: 'completed',
            pendingBefore: 2,
            pendingAfter: 2,
            additiveOnly: true,
            destructive: false,
        });
        expect(store.updateBatch).not.toHaveBeenCalled();
        expect(store.updateRun).toHaveBeenCalledWith(
            'account-center-audit-001',
            expect.objectContaining({ status: 'completed' })
        );
    });

    test('apply mode rejects execution without every release authorization gate', () => {
        expect(() => assertApplyAuthorization({
            ...APPLY_OPTIONS,
            backupEvidence: '',
        }, {
            ACCOUNT_CENTER_MIGRATION_APPLY_ENABLED: 'true',
        })).toThrow(expect.objectContaining({
            code: 'ACCOUNT_CENTER_MIGRATION_APPLY_GATE_REQUIRED',
        }));
    });

    test('apply mode pauses at a batch boundary and resumes with a repair pass', async () => {
        const store = createStore({ pendingIds: ['001', '002', '003'] });
        const dependencies = {
            store,
            env: { ACCOUNT_CENTER_MIGRATION_APPLY_ENABLED: 'true' },
            wait: jest.fn(async () => undefined),
        };

        const paused = await runAccountCenterMigration({
            ...APPLY_OPTIONS,
            maxBatches: 1,
        }, dependencies);

        expect(paused).toMatchObject({
            status: 'paused',
            pendingBefore: 3,
            pendingAfter: 1,
            batches: 1,
        });
        expect(store.getBatch).toHaveBeenLastCalledWith({ afterId: null, limit: 2 });

        const completed = await runAccountCenterMigration({
            ...APPLY_OPTIONS,
            maxBatches: 5,
        }, dependencies);

        expect(completed).toMatchObject({
            status: 'completed',
            pendingBefore: 3,
            pendingAfter: 0,
            batches: 2,
            modified: 3,
        });
        expect(store.getBatch.mock.calls[1][0]).toEqual({ afterId: null, limit: 2 });
    });

    test('records a safe failure code instead of leaving an apply run active', async () => {
        const store = createStore({ pendingIds: ['001'] });
        const batchError = Object.assign(new Error('database details must not be persisted'), {
            code: 'MONGO_WRITE_FAILED',
        });
        store.updateBatch.mockRejectedValueOnce(batchError);

        await expect(runAccountCenterMigration(APPLY_OPTIONS, {
            store,
            env: { ACCOUNT_CENTER_MIGRATION_APPLY_ENABLED: 'true' },
        })).rejects.toBe(batchError);

        expect(store.updateRun).toHaveBeenLastCalledWith(
            APPLY_OPTIONS.runId,
            expect.objectContaining({
                status: 'failed',
                lastErrorCode: 'MONGO_WRITE_FAILED',
                pendingAfter: 1,
            })
        );
        expect(JSON.stringify(store.updateRun.mock.calls.at(-1))).not.toContain(
            'database details must not be persisted'
        );
    });

    test('pending filter is version bounded and checkpoint aware', () => {
        expect(pendingVersionFilter('507f1f77bcf86cd799439299')).toEqual({
            _id: { $gt: '507f1f77bcf86cd799439299' },
            $or: [
                { accountCenterSchemaVersion: { $exists: false } },
                { accountCenterSchemaVersion: { $lt: 2 } },
            ],
        });
    });
});
