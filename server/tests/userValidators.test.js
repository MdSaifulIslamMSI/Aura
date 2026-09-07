const {
  activateSellerSchema,
  addressDeleteSchema,
  addressSchema,
  addressUpdateSchema,
  deactivateSellerSchema,
  loginSchema,
  updateProfileSchema,
} = require('../validators/userValidators');

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('userValidators login and profile', () => {
  test('login accepts email or phone with assurance tokens', () => {
    expect(() => loginSchema.parse({ body: { email: 'a@example.com' } })).not.toThrow();
    expect(() => loginSchema.parse({ body: { phone: '+919876543210' } })).not.toThrow();
  });

  test('login rejects malformed emails and phones', () => {
    expect(loginSchema.safeParse({ body: { email: 'not-an-email' } }).success).toBe(false);
    expect(loginSchema.safeParse({ body: { phone: '123' } }).success).toBe(false);
  });

  test('profile updates require at least one field', () => {
    expect(updateProfileSchema.safeParse({ body: {} }).success).toBe(false);
    expect(() => updateProfileSchema.parse({ body: { name: 'Asha' } })).not.toThrow();
  });

  test('profile updates validate phones, avatars and gender enums', () => {
    expect(() => updateProfileSchema.parse({ body: { phone: '+919876543210' } })).not.toThrow();
    expect(updateProfileSchema.safeParse({ body: { phone: '123' } }).success).toBe(false);
    expect(() => updateProfileSchema.parse({ body: { gender: 'other' } })).not.toThrow();
    expect(updateProfileSchema.safeParse({ body: { gender: 'unknown' } }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ body: { avatar: 'not-a-url' } }).success).toBe(false);
  });
});

describe('userValidators addresses and seller lifecycle', () => {
  const validAddress = {
    address: '221B Baker Street', city: 'London', state: 'London',
    pincode: '110001', name: 'Asha', phone: '+919876543210',
  };

  test('addresses enforce Indian PIN codes', () => {
    expect(() => addressSchema.parse({ body: validAddress })).not.toThrow();
    expect(addressSchema.safeParse({ body: { ...validAddress, pincode: '01234' } }).success).toBe(false);
  });

  test('address updates scope mutations to an address id', () => {
    expect(addressUpdateSchema.safeParse({ params: {}, body: validAddress }).success).toBe(false);
    expect(() => addressUpdateSchema.parse({ params: { addressId: OBJECT_ID }, body: validAddress })).not.toThrow();
  });

  test('address deletes validate the id param', () => {
    expect(() => addressDeleteSchema.parse({ params: { addressId: OBJECT_ID } })).not.toThrow();
  });

  test('seller activation requires explicit consent', () => {
    expect(() => activateSellerSchema.parse({ body: { acceptTerms: true } })).not.toThrow();
    expect(activateSellerSchema.safeParse({ body: { acceptTerms: false } }).success).toBe(false);
    expect(() => deactivateSellerSchema.parse({ body: { confirmDeactivation: true } })).not.toThrow();
    expect(deactivateSellerSchema.safeParse({ body: {} }).success).toBe(false);
  });
});
