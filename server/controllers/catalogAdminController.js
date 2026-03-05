const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    createCatalogImportJob,
    getCatalogImportJob,
    publishCatalogVersion,
    createCatalogSyncRun,
    getCatalogHealth,
} = require('../services/catalogService');
const {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
} = require('../services/payments/idempotencyService');

const createImportJob = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);
        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'catalog:create_import',
            requestPayload: req.body,
            handler: async () => {
                const job = await createCatalogImportJob({
                    sourceType: req.body.sourceType,
                    sourceRef: req.body.sourceRef,
                    mode: req.body.mode,
                    initiatedBy: req.body.initiatedBy || req.user?.email || req.user?.name || 'admin',
                    idempotencyKey,
                    requestId: req.requestId,
                    userId: req.user?._id || null,
                });

                return {
                    statusCode: 202,
                    response: {
                        jobId: job.jobId,
                        status: job.status,
                        startedAt: job.startedAt,
                        catalogVersion: job.catalogVersion,
                    },
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to create catalog import job', 500));
    }
});

const getImportJobById = asyncHandler(async (req, res, next) => {
    try {
        const job = await getCatalogImportJob(req.params.jobId);
        return res.json({
            jobId: job.jobId,
            status: job.status,
            totals: job.totals,
            errorsSample: job.errorSample || [],
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            publishable: Boolean(job.publishable),
            catalogVersion: job.catalogVersion,
            publishedAt: job.publishedAt || null,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch catalog import job', 500));
    }
});

const publishImportJob = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);
        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `catalog:publish_import:${req.params.jobId}`,
            requestPayload: req.body,
            handler: async () => {
                const published = await publishCatalogVersion(req.params.jobId);
                return {
                    statusCode: 200,
                    response: published,
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to publish catalog import', 500));
    }
});

const createSyncRun = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);
        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'catalog:create_sync_run',
            requestPayload: req.body,
            handler: async () => {
                const syncRun = await createCatalogSyncRun({
                    provider: req.body.provider,
                    cursor: req.body.cursor,
                    idempotencyKey,
                    requestId: req.requestId,
                    userId: req.user?._id || null,
                });

                return {
                    statusCode: 202,
                    response: {
                        syncRunId: syncRun.syncRunId,
                        accepted: true,
                        status: syncRun.status,
                    },
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to queue catalog sync run', 500));
    }
});

const getCatalogOpsHealth = asyncHandler(async (req, res, next) => {
    try {
        const health = await getCatalogHealth();
        return res.json(health);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch catalog health', 500));
    }
});

module.exports = {
    createImportJob,
    getImportJobById,
    publishImportJob,
    createSyncRun,
    getCatalogOpsHealth,
};
