const { z } = require('zod');

const routeContextSchema = z.object({
    path: z.string().trim().min(1).max(240),
    label: z.string().trim().max(120).optional(),
    entityType: z.enum(['home', 'category', 'product', 'cart', 'checkout', 'orders', 'search', 'assistant', 'unknown']).optional(),
    entityId: z.string().trim().max(120).optional(),
}).strict();

const commerceContextSchema = z.object({
    activeProductId: z.string().trim().max(120).optional(),
    candidateProductIds: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    cartSummary: z.object({
        totalPrice: z.number().nonnegative().optional(),
        totalOriginalPrice: z.number().nonnegative().optional(),
        totalDiscount: z.number().nonnegative().optional(),
        totalItems: z.number().int().nonnegative().optional(),
        itemCount: z.number().int().nonnegative().optional(),
        currency: z.string().trim().max(12).optional(),
    }).strict().optional(),
}).strict().optional();

const userContextSchema = z.object({
    authenticated: z.boolean().optional(),
}).strict().optional();

const assistantTurnSchema = z.object({
    body: z.object({
        sessionId: z.string().trim().max(120).optional(),
        message: z.string().trim().min(1).max(1200),
        routeContext: routeContextSchema,
        commerceContext: commerceContextSchema,
        userContext: userContextSchema,
    }).strict(),
});

module.exports = {
    assistantTurnSchema,
};
