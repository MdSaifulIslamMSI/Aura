const { z } = require('zod');

const channelSchema = z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    push: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one channel must be provided',
});

const notificationSchema = z.object({
    orderUpdates: channelSchema.optional(),
    deliveryUpdates: channelSchema.optional(),
    returnRefundUpdates: channelSchema.optional(),
    marketplaceUpdates: channelSchema.optional(),
    productAlerts: channelSchema.optional(),
    marketing: channelSchema.optional(),
    security: channelSchema.optional(),
}).strict();

const getAccountPreferencesSchema = z.object({
    body: z.object({}).strict().optional(),
    query: z.object({}).strict().optional(),
    params: z.object({}).strict().optional(),
});

const updateAccountPreferencesSchema = z.object({
    body: z.object({
        version: z.number().int().nonnegative(),
        notifications: notificationSchema.optional(),
        localization: z.object({
            language: z.enum(['en', 'bn', 'hi', 'te', 'mr', 'ur', 'gu', 'pa', 'ml', 'kn', 'or', 'as', 'sa', 'es', 'fr', 'de', 'ar', 'ja', 'pt', 'zh']).optional(),
            locale: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, 'Invalid locale').optional(),
            currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Invalid currency').optional(),
        }).strict().optional(),
        accessibility: z.object({
            reducedMotion: z.boolean().optional(),
            highContrast: z.boolean().optional(),
        }).strict().optional(),
    }).strict().refine((value) => (
        Boolean(value.notifications || value.localization || value.accessibility)
    ), {
        message: 'At least one preference group must be provided',
    }),
    query: z.object({}).strict().optional(),
    params: z.object({}).strict().optional(),
});

module.exports = {
    getAccountPreferencesSchema,
    updateAccountPreferencesSchema,
};
