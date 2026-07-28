const { z } = require('zod');

const objectIdSchema = z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid privacy request identifier');
const emptyQuery = z.object({}).strict().optional();
const emptyParams = z.object({}).strict().optional();

const requestExportSchema = z.object({
    body: z.object({
        scope: z.literal('account').default('account').optional(),
    }).strict(),
    params: emptyParams,
    query: emptyQuery,
}).strict();

const requestDeactivationSchema = z.object({
    body: z.object({
        confirmation: z.literal('DEACTIVATE'),
    }).strict(),
    params: emptyParams,
    query: emptyQuery,
}).strict();

const requestDeletionSchema = z.object({
    body: z.object({
        confirmation: z.literal('DELETE MY ACCOUNT'),
    }).strict(),
    params: emptyParams,
    query: emptyQuery,
}).strict();

const privacyRequestIdSchema = z.object({
    body: z.object({}).strict().optional(),
    params: z.object({
        requestId: objectIdSchema,
    }).strict(),
    query: emptyQuery,
}).strict();

module.exports = {
    privacyRequestIdSchema,
    requestDeactivationSchema,
    requestDeletionSchema,
    requestExportSchema,
};
