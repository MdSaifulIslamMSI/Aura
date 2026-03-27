const { z } = require('zod');
const { PAYMENT_METHODS } = require('../services/payments/constants');

const productIdentifier = z.union([z.number(), z.string()]).optional();
const quantityField = z.coerce.number().int().positive().optional();

const orderItemSchema = z
    .object({
        product: productIdentifier,
        productId: productIdentifier,
        id: productIdentifier,
        qty: quantityField,
        quantity: quantityField,
    })
    .refine((item) => item.product !== undefined || item.productId !== undefined || item.id !== undefined, {
        message: 'Each order item must include product/productId/id',
        path: ['product'],
    })
    .refine((item) => item.qty !== undefined || item.quantity !== undefined, {
        message: 'Each order item must include qty or quantity',
        path: ['quantity'],
    });

const shippingAddressSchema = z.object({
    address: z.string().min(1).optional(),
    street: z.string().min(1).optional(),
    city: z.string().min(1),
    postalCode: z.string().min(1).optional(),
    pincode: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
}).refine((value) => value.address || value.street, {
    message: 'shippingAddress.address or shippingAddress.street is required',
    path: ['address'],
}).refine((value) => value.postalCode || value.pincode, {
    message: 'shippingAddress.postalCode or shippingAddress.pincode is required',
    path: ['postalCode'],
}).refine((value) => value.country || value.state, {
    message: 'shippingAddress.country or shippingAddress.state is required',
    path: ['country'],
});

const deliverySlotSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    window: z.string().min(1),
});

const normalizeUpper = (value) => String(value || '').trim().toUpperCase();

const marketContextSchema = z.object({
    countryCode: z.string().trim().length(2)
        .regex(/^[A-Za-z]{2}$/)
        .transform((value) => normalizeUpper(value)),
    currency: z.string().trim().length(3)
        .regex(/^[A-Za-z]{3}$/)
        .transform((value) => normalizeUpper(value)),
    language: z.string().trim().min(2).max(5).optional(),
}).strict();

const netbankingContextSchema = z.object({
    bankCode: z.string().trim().min(3).max(20)
        .regex(/^[A-Za-z0-9_]+$/)
        .transform((value) => normalizeUpper(value)),
    bankName: z.string().trim().min(2).max(120).optional(),
    source: z.enum(['catalog', 'saved_method', 'manual']).optional(),
}).strict();

const checkoutBodySchema = z.object({
    orderItems: z.array(orderItemSchema).min(1),
    shippingAddress: shippingAddressSchema,
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paymentIntentId: z.string().trim().min(6).optional(),
    deliveryOption: z.enum(['standard', 'express']).optional(),
    deliverySlot: deliverySlotSchema.optional(),
    couponCode: z.string().trim().max(30).optional(),
    checkoutSource: z.enum(['cart', 'directBuy']).optional(),
    quoteSnapshot: z.object({
        totalPrice: z.coerce.number().positive().optional(),
        baseAmount: z.coerce.number().positive().optional(),
        baseCurrency: z.string().trim().length(3)
            .regex(/^[A-Za-z]{3}$/)
            .transform((value) => normalizeUpper(value))
            .optional(),
        displayAmount: z.coerce.number().positive().optional(),
        displayCurrency: z.string().trim().length(3)
            .regex(/^[A-Za-z]{3}$/)
            .transform((value) => normalizeUpper(value))
            .optional(),
        fxRateLocked: z.coerce.number().positive().optional(),
        fxTimestamp: z.string().trim().min(4).optional(),
        presentmentTotalPrice: z.coerce.number().positive().optional(),
        presentmentCurrency: z.string().trim().length(3)
            .regex(/^[A-Za-z]{3}$/)
            .transform((value) => normalizeUpper(value))
            .optional(),
        pricingVersion: z.string().optional(),
    }).optional(),
    paymentContext: z.object({
        market: marketContextSchema.optional(),
        netbanking: netbankingContextSchema.optional(),
    }).strict().optional(),
});

const quoteOrderSchema = z.object({
    body: checkoutBodySchema,
});

const createOrderSchema = z.object({
    body: checkoutBodySchema,
});

const getOrderTimelineSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
    }),
});

const commandCenterParamsSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
    }),
});

const commandCenterRefundSchema = z.object({
    ...commandCenterParamsSchema.shape,
    body: z.object({
        reason: z.string().trim().min(3).max(300),
        amount: z.coerce.number().positive().optional(),
    }),
});

const commandCenterReplaceSchema = z.object({
    ...commandCenterParamsSchema.shape,
    body: z.object({
        reason: z.string().trim().min(3).max(300),
        itemProductId: z.union([z.string(), z.number()]).optional(),
        itemTitle: z.string().trim().max(180).optional(),
        quantity: z.coerce.number().int().positive().max(10).optional(),
    }),
});

const commandCenterSupportSchema = z.object({
    ...commandCenterParamsSchema.shape,
    body: z.object({
        message: z.string().trim().min(3).max(1500),
    }),
});

const commandCenterWarrantySchema = z.object({
    ...commandCenterParamsSchema.shape,
    body: z.object({
        issue: z.string().trim().min(3).max(500),
        itemProductId: z.union([z.string(), z.number()]).optional(),
        itemTitle: z.string().trim().max(180).optional(),
    }),
});

const cancelOrderSchema = z.object({
    ...commandCenterParamsSchema.shape,
    body: z.object({
        reason: z.string().trim().min(3).max(300).optional(),
    }).optional(),
});

const adminOrderStatusSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
    }),
    body: z.object({
        status: z.enum(['processing', 'shipped', 'delivered']),
        note: z.string().trim().max(300).optional(),
    }),
});

const adminCancelOrderSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
    }),
    body: z.object({
        reason: z.string().trim().min(3).max(300).optional(),
    }).optional(),
});

const adminCommandRefundDecisionSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
        requestId: z.string().trim().min(4).max(120),
    }),
    body: z.object({
        status: z.enum(['approved', 'rejected', 'processed']),
        note: z.string().trim().max(300).optional(),
        amount: z.coerce.number().positive().optional(),
        externalReference: z.string().trim().max(120).optional(),
    }),
});

const adminCommandReplacementDecisionSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
        requestId: z.string().trim().min(4).max(120),
    }),
    body: z.object({
        status: z.enum(['approved', 'rejected', 'shipped']),
        note: z.string().trim().max(300).optional(),
        trackingId: z.string().trim().max(120).optional(),
    }),
});

const adminCommandSupportReplySchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
    }),
    body: z.object({
        message: z.string().trim().min(3).max(1500),
    }),
});

const adminCommandWarrantyDecisionSchema = z.object({
    params: z.object({
        id: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid order id'),
        claimId: z.string().trim().min(4).max(120),
    }),
    body: z.object({
        status: z.enum(['in_review', 'approved', 'rejected']),
        note: z.string().trim().max(500).optional(),
    }),
});

module.exports = {
    quoteOrderSchema,
    createOrderSchema,
    getOrderTimelineSchema,
    commandCenterParamsSchema,
    commandCenterRefundSchema,
    commandCenterReplaceSchema,
    commandCenterSupportSchema,
    commandCenterWarrantySchema,
    cancelOrderSchema,
    adminOrderStatusSchema,
    adminCancelOrderSchema,
    adminCommandRefundDecisionSchema,
    adminCommandReplacementDecisionSchema,
    adminCommandSupportReplySchema,
    adminCommandWarrantyDecisionSchema,
};
