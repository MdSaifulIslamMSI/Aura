const { z } = require('zod');
const {
    EMERGENCY_CONFIRMATION_PHRASE,
    EMERGENCY_FLAG_KEYS,
    EMERGENCY_SEVERITIES,
} = require('../config/emergencyControlConstants');

const flagKeyParam = z.object({
    key: z.enum(EMERGENCY_FLAG_KEYS),
});

const optionalFutureDate = z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return null;
    return value;
}, z.string().datetime({ offset: true }).nullable());

const activateEmergencyFlagSchema = z.object({
    params: flagKeyParam,
    query: z.object({}).passthrough(),
    body: z.object({
        reason: z.string().trim().max(2000).optional().default(''),
        userMessage: z.string().trim().max(500).optional().default(''),
        severity: z.enum(EMERGENCY_SEVERITIES).optional(),
        expiresAt: optionalFutureDate.optional(),
        startsAt: optionalFutureDate.optional(),
        requiresDualApproval: z.boolean().optional().default(false),
        approvedByUserId: z.string().trim().optional().default(''),
        approvedByEmail: z.string().trim().email().optional().or(z.literal('')).default(''),
        metadata: z.record(z.any()).optional().default({}),
        confirmationPhrase: z.string().trim().optional().default(''),
        noExpiryConfirmed: z.boolean().optional().default(false),
    }),
});

const deactivateEmergencyFlagSchema = z.object({
    params: flagKeyParam,
    query: z.object({}).passthrough(),
    body: z.object({
        reason: z.string().trim().max(2000).optional().default(''),
        confirmationPhrase: z.string().trim().optional().default(''),
    }),
});

const extendEmergencyFlagSchema = z.object({
    params: flagKeyParam,
    query: z.object({}).passthrough(),
    body: z.object({
        reason: z.string().trim().max(2000).optional().default(''),
        expiresAt: z.string().datetime({ offset: true }),
    }),
});

const updateEmergencyMessageSchema = z.object({
    params: flagKeyParam,
    query: z.object({}).passthrough(),
    body: z.object({
        reason: z.string().trim().max(2000).optional().default(''),
        userMessage: z.string().trim().min(1).max(500),
    }),
});

const listEmergencyAuditSchema = z.object({
    params: z.object({}).passthrough(),
    query: z.object({
        flagKey: z.enum(EMERGENCY_FLAG_KEYS).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    }).passthrough(),
    body: z.object({}).passthrough(),
});

module.exports = {
    EMERGENCY_CONFIRMATION_PHRASE,
    activateEmergencyFlagSchema,
    deactivateEmergencyFlagSchema,
    extendEmergencyFlagSchema,
    listEmergencyAuditSchema,
    updateEmergencyMessageSchema,
};
