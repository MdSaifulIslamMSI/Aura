const {
    addressSchema,
    addressUpdateSchema,
    addressDeleteSchema,
} = require('../validators/userValidators');

const validAddress = {
    type: 'home',
    name: 'Address User',
    phone: '+919876543210',
    address: '12 Market Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    isDefault: true,
};

describe('account address validators', () => {
    test('accepts the complete mutable allowlist and rejects mass assignment', () => {
        expect(addressSchema.safeParse({ body: validAddress }).success).toBe(true);
        expect(addressSchema.safeParse({
            body: { ...validAddress, owner: '507f1f77bcf86cd799439011' },
        }).success).toBe(false);
    });

    test('requires contact fields that are mandatory in the persisted schema', () => {
        expect(addressSchema.safeParse({
            body: { ...validAddress, name: undefined },
        }).success).toBe(false);
        expect(addressSchema.safeParse({
            body: { ...validAddress, phone: undefined },
        }).success).toBe(false);
    });

    test('validates embedded address identifiers before controller access', () => {
        expect(addressUpdateSchema.safeParse({
            body: validAddress,
            params: { addressId: '507f1f77bcf86cd799439011' },
        }).success).toBe(true);
        expect(addressDeleteSchema.safeParse({
            params: { addressId: 'not-an-object-id' },
        }).success).toBe(false);
    });
});
