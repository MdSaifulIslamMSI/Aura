const { z } = require('zod');

const paymentMethodEnum = z.enum(['UPI', 'CARD', 'WALLET']);

const createIntentSchema = z.object({
    body: z.object({
        quotePayload: z.object({}).passthrough(),
        quoteSnapshot: z.object({
            totalPrice: z.coerce.number().positive().optional(),
            pricingVersion: z.string().optional(),
        }).optional(),
        paymentMethod: paymentMethodEnum,
        savedMethodId: z.string().trim().min(6).max(64).optional(),
        deviceContext: z.object({
            userAgent: z.string().max(400).optional(),
            platform: z.string().max(120).optional(),
            language: z.string().max(40).optional(),
            screen: z.string().max(40).optional(),
        }).optional(),
    }),
});

const completeChallengeSchema = z.object({
    params: z.object({
        intentId: z.string().min(6),
    }),
    body: z.object({
        challengeToken: z.string().trim().min(20),
    }),
});

const confirmIntentSchema = z.object({
    params: z.object({
        intentId: z.string().min(6),
    }),
    body: z.object({
        providerPaymentId: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9._-]+$/),
        providerOrderId: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9._-]+$/),
        providerSignature: z.string().trim().min(6).max(200).regex(/^[A-Za-z0-9+/=._-]+$/),
    }),
});

const getIntentSchema = z.object({
    params: z.object({
        intentId: z.string().min(6),
    }),
});

const refundSchema = z.object({
    params: z.object({
        intentId: z.string().min(6),
    }),
    body: z.object({
        amount: z.coerce.number().positive().optional(),
        reason: z.string().trim().min(2).max(140).optional(),
    }),
});

const paymentMethodSchema = z.object({
    body: z.object({
        providerMethodId: z.string().trim().min(2),
        provider: z.string().trim().min(2).optional(),
        type: z.enum(['card', 'upi', 'wallet', 'bank', 'other']).optional(),
        brand: z.string().trim().max(40).optional(),
        last4: z.string().trim().max(8).optional(),
        metadata: z.object({}).passthrough().optional(),
    }),
});

const methodIdParamSchema = z.object({
    params: z.object({
        methodId: z.string().min(6),
    }),
});

const adminPaymentListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: z.string().optional(),
        provider: z.string().optional(),
        method: z.string().optional(),
    }),
});

const adminPaymentDetailSchema = z.object({
    params: z.object({
        intentId: z.string().min(6),
    }),
});

const adminRefundLedgerListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: z.enum(['pending', 'approved', 'rejected', 'processed']).optional(),
        settlement: z.enum(['provider', 'manual', 'queued', 'manual_review', 'none']).optional(),
        reconciliation: z.enum([
            'pending',
            'provider_verified',
            'provider_unverified',
            'manual_recorded',
            'manual_reference_missing',
            'n/a',
        ]).optional(),
        method: z.string().trim().max(20).optional(),
        provider: z.string().trim().max(30).optional(),
        query: z.string().trim().max(120).optional(),
        from: z.string().trim().max(40).optional(),
        to: z.string().trim().max(40).optional(),
    }),
});

const adminRefundLedgerUpdateSchema = z.object({
    params: z.object({
        orderId: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
        requestId: z.string().trim().min(4).max(120),
    }),
    body: z.object({
        refundId: z.string().trim().min(3).max(120),
        note: z.string().trim().max(300).optional(),
    }),
});

module.exports = {
    createIntentSchema,
    completeChallengeSchema,
    confirmIntentSchema,
    getIntentSchema,
    refundSchema,
    paymentMethodSchema,
    methodIdParamSchema,
    adminPaymentListSchema,
    adminPaymentDetailSchema,
    adminRefundLedgerListSchema,
    adminRefundLedgerUpdateSchema,
};
