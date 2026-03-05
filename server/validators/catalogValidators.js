const { z } = require('zod');

const sourceTypeSchema = z.enum(['json', 'jsonl', 'ndjson', 'csv']);
const providerSchema = z.string().trim().min(1).max(60);

const createCatalogImportSchema = z.object({
    body: z.object({
        sourceType: sourceTypeSchema,
        sourceRef: z.string().trim().min(1).max(500),
        mode: z.string().trim().min(1).max(60).default('batch').optional(),
        initiatedBy: z.string().trim().max(120).optional(),
    }).strict(),
});

const getCatalogImportSchema = z.object({
    params: z.object({
        jobId: z.string().trim().min(1).max(120),
    }),
});

const publishCatalogImportSchema = z.object({
    params: z.object({
        jobId: z.string().trim().min(1).max(120),
    }),
    body: z.object({
        confirm: z.literal(true),
    }).strict(),
});

const createCatalogSyncRunSchema = z.object({
    body: z.object({
        provider: providerSchema.optional(),
        cursor: z.string().trim().max(250).optional(),
    }).strict(),
});

module.exports = {
    createCatalogImportSchema,
    getCatalogImportSchema,
    publishCatalogImportSchema,
    createCatalogSyncRunSchema,
};
