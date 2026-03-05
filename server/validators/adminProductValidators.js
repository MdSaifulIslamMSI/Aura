const { z } = require('zod');

const productIdentifierSchema = z.string()
    .trim()
    .min(1, 'Invalid product identifier')
    .max(120, 'Invalid product identifier')
    .regex(/^[A-Za-z0-9._-]+$/, 'Invalid product identifier');

const mediaUrlSchema = z.string().trim().url('Image URL must be a valid URL');

const highlightSchema = z.string()
    .trim()
    .min(1)
    .max(120);

const specificationItemSchema = z.object({
    key: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(300),
}).strict();

const adCampaignSchema = z.object({
    isSponsored: z.boolean().optional(),
    status: z.enum(['inactive', 'active', 'paused', 'expired']).optional(),
    priority: z.coerce.number().int().min(0).max(100).optional(),
    cpcBid: z.coerce.number().min(0).max(100000).optional(),
    budgetTotal: z.coerce.number().min(0).max(100000000).optional(),
    budgetSpent: z.coerce.number().min(0).max(100000000).optional(),
    placement: z.enum(['search', 'listing', 'home', 'all']).optional(),
    creativeTagline: z.string().trim().max(120).optional(),
    startsAt: z.union([z.coerce.date(), z.null()]).optional(),
    endsAt: z.union([z.coerce.date(), z.null()]).optional(),
}).strict().optional();

const adminProductListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        search: z.string().trim().max(120).optional(),
        source: z.enum(['manual', 'batch', 'provider']).optional(),
        category: z.string().trim().max(120).optional(),
        brand: z.string().trim().max(120).optional(),
        sort: z.enum(['newest', 'oldest', 'price-asc', 'price-desc', 'stock-asc', 'stock-desc']).optional(),
    }),
});

const adminProductDetailSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
});

const adminCreateProductSchema = z.object({
    body: z.object({
        title: z.string().trim().min(3).max(160),
        price: z.coerce.number().min(0).max(100000000),
        originalPrice: z.coerce.number().min(0).max(100000000).optional(),
        discountPercentage: z.coerce.number().min(0).max(100).optional(),
        description: z.string().trim().min(10).max(5000),
        category: z.string().trim().min(2).max(120),
        subCategory: z.string().trim().max(120).optional(),
        brand: z.string().trim().min(2).max(120),
        image: mediaUrlSchema,
        stock: z.coerce.number().int().min(0).max(1000000).optional(),
        countInStock: z.coerce.number().int().min(0).max(1000000).optional(),
        deliveryTime: z.string().trim().max(60).optional(),
        warranty: z.string().trim().max(160).optional(),
        highlights: z.array(highlightSchema).max(12).optional(),
        specifications: z.array(specificationItemSchema).max(30).optional(),
        adCampaign: adCampaignSchema,
    }).strict(),
});

const adminUpdateProductCoreSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    body: z.object({
        title: z.string().trim().min(3).max(160).optional(),
        description: z.string().trim().min(10).max(5000).optional(),
        category: z.string().trim().min(2).max(120).optional(),
        subCategory: z.string().trim().max(120).optional(),
        brand: z.string().trim().min(2).max(120).optional(),
        image: mediaUrlSchema.optional(),
        stock: z.coerce.number().int().min(0).max(1000000).optional(),
        countInStock: z.coerce.number().int().min(0).max(1000000).optional(),
        deliveryTime: z.string().trim().max(60).optional(),
        warranty: z.string().trim().max(160).optional(),
        highlights: z.array(highlightSchema).max(12).optional(),
        specifications: z.array(specificationItemSchema).max(30).optional(),
        adCampaign: adCampaignSchema,
        reason: z.string().trim().min(5).max(500).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, {
        message: 'At least one core field must be provided',
    }),
});

const adminUpdateProductPricingSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    body: z.object({
        price: z.coerce.number().min(0).max(100000000),
        originalPrice: z.coerce.number().min(0).max(100000000).optional(),
        discountPercentage: z.coerce.number().min(0).max(100).optional(),
        reason: z.string().trim().min(5).max(500),
    }).strict(),
});

const adminDeleteProductSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    body: z.object({
        reason: z.string().trim().min(5).max(500).optional(),
    }).strict().optional(),
});

module.exports = {
    adminProductListSchema,
    adminProductDetailSchema,
    adminCreateProductSchema,
    adminUpdateProductCoreSchema,
    adminUpdateProductPricingSchema,
    adminDeleteProductSchema,
};

