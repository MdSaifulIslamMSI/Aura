const { z } = require('zod');

const productIdentifierSchema = z.string()
    .trim()
    .min(1, 'Invalid Product ID')
    .max(120, 'Invalid Product ID')
    .regex(/^[A-Za-z0-9._-]+$/, 'Invalid Product ID');

const mediaUrlSchema = z.string().trim().min(1).max(2048).refine(
    (value) => /^https?:\/\/[^\s]+$/i.test(value) || /^\/uploads\/[^\s]+$/i.test(value),
    { message: 'Media URL must be an http(s) URL or /uploads path' }
);

const booleanLikeSchema = z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    const raw = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off', ''].includes(raw)) return false;
    return value;
}, z.boolean());

const adCampaignSchema = z.object({
    isSponsored: booleanLikeSchema.optional(),
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

const productSearchSchema = z.object({
    query: z.object({
        keyword: z.string().trim().max(100).optional(),
        telemetryContext: z.string().trim().max(80).optional(),
        page: z.preprocess((val) => Number(val), z.number().int().min(1).default(1)).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50).default(12)).optional(),
        nextCursor: z.string().optional(),
        category: z.string().trim().max(180).optional(),
        brand: z.string().trim().max(180).optional(),
        minPrice: z.preprocess((val) => Number(val), z.number().min(0)).optional(),
        maxPrice: z.preprocess((val) => Number(val), z.number().min(0)).optional(),
        rating: z.preprocess((val) => Number(val), z.number().min(0).max(5)).optional(),
        discount: z.preprocess((val) => Number(val), z.number().min(0).max(100)).optional(),
        inStock: z.enum(['true', 'false']).optional(),
        minStock: z.preprocess((val) => Number(val), z.number().min(0)).optional(),
        hasWarranty: z.enum(['true', 'false']).optional(),
        minReviews: z.preprocess((val) => Number(val), z.number().min(0)).optional(),
        deliveryTime: z.string().trim().max(180).optional(),
        includeDealDna: z.enum(['true', 'false']).optional(),
        includeSponsored: z.enum(['true', 'false']).optional(),
        sponsoredSlots: z.preprocess((val) => Number(val), z.number().int().min(0).max(4)).optional(),
        sort: z.enum(['relevance', 'price-asc', 'price-desc', 'rating', 'newest', 'discount']).default('relevance').optional(),
    }),
});

const productRecommendationSchema = z.object({
    body: z.object({
        recentlyViewed: z.array(z.object({
            id: z.union([z.string(), z.number()]).optional(),
            _id: z.string().trim().max(120).optional(),
            category: z.string().trim().max(180).optional(),
            brand: z.string().trim().max(120).optional(),
        }).strict()).max(8).optional(),
        searchHistory: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(12).default(6)).optional(),
    }).strict(),
});

const visualSearchSchema = z.object({
    body: z.object({
        imageUrl: z.string().trim().url('Invalid image URL').optional(),
        fileName: z.string().trim().max(240).optional(),
        hints: z.string().trim().max(240).optional(),
        imageMeta: z.object({
            source: z.enum(['upload', 'clipboard', 'url']).optional(),
            mimeType: z.string().trim().max(120).optional(),
            sizeBytes: z.preprocess((val) => Number(val), z.number().int().min(0).max(25_000_000)).optional(),
            width: z.preprocess((val) => Number(val), z.number().int().min(1).max(12000)).optional(),
            height: z.preprocess((val) => Number(val), z.number().int().min(1).max(12000)).optional(),
        }).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(24).default(12)).optional(),
    }).refine((value) => Boolean(value.imageUrl || value.fileName || value.hints || value.imageMeta), {
        message: 'Provide imageUrl, fileName, hints, or image metadata for visual search',
    }),
});

const bundleBuildSchema = z.object({
    body: z.object({
        theme: z.string().trim().min(2).max(120),
        budget: z.preprocess((val) => Number(val), z.number().positive().max(500000)),
        maxItems: z.preprocess((val) => Number(val), z.number().int().min(2).max(12)).optional(),
    }),
});

const highlightSchema = z.string().trim().min(1).max(120);
const specificationItemSchema = z.object({
    key: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(300),
}).strict();

const updateProductSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    body: z.object({
        title: z.string().trim().min(3, 'Title must be at least 3 characters').optional(),
        price: z.coerce.number().min(0, 'Price must be positive').optional(),
        originalPrice: z.coerce.number().min(0).optional(),
        description: z.string().trim().max(5000).optional(),
        category: z.string().trim().min(2).optional(),
        subCategory: z.string().trim().max(120).optional(),
        brand: z.string().trim().min(2).optional(),
        image: z.string().trim().url('Invalid URL').optional(),
        stock: z.coerce.number().int().min(0).optional(),
        countInStock: z.coerce.number().int().min(0).optional(),
        discountPercentage: z.coerce.number().min(0).max(100).optional(),
        deliveryTime: z.string().trim().max(60).optional(),
        warranty: z.string().trim().max(160).optional(),
        highlights: z.array(highlightSchema).max(12).optional(),
        specifications: z.array(specificationItemSchema).max(30).optional(),
        adCampaign: adCampaignSchema,
    }).strict().refine((value) => Object.keys(value).length > 0, {
        message: 'At least one field must be provided',
    }),
});

const createProductSchema = z.object({
    body: z.object({
        title: z.string().trim().min(3, 'Title is required'),
        price: z.coerce.number().min(0, 'Price/MRP must be positive'),
        originalPrice: z.coerce.number().min(0).optional(),
        description: z.string().trim().min(10, 'Description is required'),
        category: z.string().trim().min(2, 'Category is required'),
        subCategory: z.string().trim().max(120).optional(),
        brand: z.string().trim().min(2, 'Brand is required'),
        image: z.string().trim().url('Image URL is required'),
        stock: z.coerce.number().int().min(0).optional(),
        countInStock: z.coerce.number().int().min(0).optional(),
        discountPercentage: z.coerce.number().min(0).max(100).optional(),
        deliveryTime: z.string().trim().max(60).optional(),
        warranty: z.string().trim().max(160).optional(),
        highlights: z.array(highlightSchema).max(12).optional(),
        specifications: z.array(specificationItemSchema).max(30).optional(),
        adCampaign: adCampaignSchema,
    }).strict(),
});

const deleteProductSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
});

const getProductByIdSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
});

const getProductDealDnaSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
});

const getProductCompatibilitySchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    query: z.object({
        limitPerType: z.preprocess((val) => Number(val), z.number().int().min(1).max(8)).optional(),
    }),
});

const getProductReviewsSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    query: z.object({
        page: z.preprocess((val) => Number(val), z.number().int().min(1).default(1)).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(20).default(8)).optional(),
        sort: z.enum(['newest', 'oldest', 'top-rating', 'helpful']).optional(),
        mediaOnly: z.enum(['true', 'false']).optional(),
        minRating: z.preprocess((val) => Number(val), z.number().min(1).max(5)).optional(),
    }),
});

const reviewMediaSchema = z.object({
    type: z.enum(['image', 'video']),
    url: mediaUrlSchema,
    caption: z.string().trim().max(160).optional(),
});

const createProductReviewSchema = z.object({
    params: z.object({
        id: productIdentifierSchema,
    }),
    body: z.object({
        rating: z.preprocess((val) => Number(val), z.number().min(1).max(5)),
        comment: z.string().trim().min(8).max(1800),
        media: z.array(reviewMediaSchema).max(8).optional(),
    }).strict(),
});

const trackSearchClickSchema = z.object({
    body: z.object({
        searchEventId: z.string().trim().min(6).max(120).optional(),
        productId: z.union([z.string().trim().min(1).max(120), z.number()]),
        position: z.coerce.number().int().min(0).max(200).optional(),
        sourceContext: z.string().trim().max(80).optional(),
        query: z.string().trim().max(120).optional(),
        filters: z.object({}).passthrough().optional(),
    }).strict(),
});

module.exports = {
    productSearchSchema,
    productRecommendationSchema,
    visualSearchSchema,
    bundleBuildSchema,
    getProductDealDnaSchema,
    getProductCompatibilitySchema,
    getProductReviewsSchema,
    createProductReviewSchema,
    updateProductSchema,
    createProductSchema,
    deleteProductSchema,
    getProductByIdSchema,
    trackSearchClickSchema,
};
