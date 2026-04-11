const { z } = require('zod');
const PHONE_REGEX = /^\+?\d{10,15}$/;

const loginSchema = z.object({
    body: z.object({
        email: z.string()
            .trim()
            .optional()
            .refine((value) => !value || z.string().email().safeParse(value).success, 'Invalid email address'),
        name: z.string().trim().max(100, 'Name is too long').optional(),
        phone: z.string()
            .trim()
            .optional()
            .refine((value) => !value || PHONE_REGEX.test(value), 'Invalid phone number'),
        flowToken: z.string().trim().max(4096, 'Invalid login assurance token').optional(),
    }),
});

const updateProfileSchema = z.object({
    body: z.object({
        name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name too long').optional(),
        phone: z.string().trim().regex(PHONE_REGEX, 'Invalid phone number').optional(),
        avatar: z.string().url().optional().or(z.literal('')),
        gender: z.enum(['male', 'female', 'other', 'prefer-not-to-say', '']).optional(),
        dob: z.union([z.string().datetime(), z.literal(''), z.null()]).optional(),
        bio: z.string().trim().max(500).optional().or(z.literal('')),
    }).strict().refine(data => Object.keys(data).length > 0, {
        message: 'At least one field must be provided to update',
    }),
});

const addressSchema = z.object({
    body: z.object({
        address: z.string().trim().min(5, 'Address must be at least 5 characters').max(200),
        city: z.string().trim().min(2, 'City is required').max(50),
        state: z.string().trim().min(2, 'State is required').max(50),
        pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Invalid Indian PIN code (6 digits)'),
        name: z.string().trim().min(2).optional(),
        phone: z.string().trim().regex(PHONE_REGEX, 'Invalid phone number').optional(),
        type: z.enum(['home', 'work', 'other']).default('home'),
        isDefault: z.boolean().default(false),
    }),
});

const activateSellerSchema = z.object({
    body: z.object({
        acceptTerms: z.boolean().refine((value) => value === true, 'acceptTerms must be true'),
    }).strict(),
});

const deactivateSellerSchema = z.object({
    body: z.object({
        confirmDeactivation: z.boolean().refine((value) => value === true, 'confirmDeactivation must be true'),
    }).strict(),
});

module.exports = {
    loginSchema,
    updateProfileSchema,
    addressSchema,
    activateSellerSchema,
    deactivateSellerSchema,
};
