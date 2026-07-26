const { z } = require('zod');

const emptyBodySchema = z.object({}).strict().optional();
const emptyQuerySchema = z.object({}).strict().optional();

const getAccountSessionsSchema = z.object({
    body: emptyBodySchema,
    params: z.object({}).strict().optional(),
    query: z.object({
        limit: z.coerce.number().int().min(1).max(20).optional(),
    }).strict().optional(),
}).strict();

const sessionAliasParamsSchema = z.object({
    sessionAlias: z.string().trim().regex(
        /^[A-Za-z0-9_-]{43}$/,
        'sessionAlias must be an opaque session identifier'
    ),
}).strict();

const revokeAccountSessionSchema = z.object({
    body: emptyBodySchema,
    params: sessionAliasParamsSchema,
    query: emptyQuerySchema,
}).strict();

const revokeOtherAccountSessionsSchema = z.object({
    body: emptyBodySchema,
    params: z.object({}).strict().optional(),
    query: emptyQuerySchema,
}).strict();

module.exports = {
    getAccountSessionsSchema,
    revokeAccountSessionSchema,
    revokeOtherAccountSessionsSchema,
};
