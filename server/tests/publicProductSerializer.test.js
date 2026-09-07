const {
  INTERNAL_FIELD_NAMES,
  hasInternalProductFields,
  pickPublicProductFields,
} = require('../serializers/publicProductSerializer');

const fullProduct = () => ({
  _id: 'mongo-1',
  id: 'p-1',
  title: 'Aura Phone',
  brand: 'Aura',
  category: 'Phones',
  price: 54999,
  stock: 5,
  provenance: { sourceType: 'first-party', sourceRef: '/srv/secrets/path', ingestHash: 'abc' },
  publishGate: { status: 'published', reviewedBy: 'admin-1' },
  contentQuality: { score: 9 },
  adCampaign: { isSponsored: true, creativeTagline: 'Festive pick', cpcBid: 50, budgetTotal: 1000 },
  catalogVersion: 42,
  searchText: 'aura phone',
  __v: 3,
});

describe('publicProductSerializer.pickPublicProductFields', () => {
  test('keeps storefront scalar fields', () => {
    const picked = pickPublicProductFields(fullProduct());
    expect(picked).toMatchObject({ id: 'p-1', title: 'Aura Phone', brand: 'Aura', price: 54999, stock: 5 });
  });

  test('reduces provenance to sourceType only', () => {
    expect(pickPublicProductFields(fullProduct()).provenance).toEqual({ sourceType: 'first-party' });
  });

  test('reduces publishGate to status only', () => {
    expect(pickPublicProductFields(fullProduct()).publishGate).toEqual({ status: 'published' });
  });

  test('reduces adCampaign to sponsorship flag and tagline', () => {
    expect(pickPublicProductFields(fullProduct()).adCampaign).toEqual({
      isSponsored: true,
      creativeTagline: 'Festive pick',
    });
  });

  test('drops pure-internal fields (catalogVersion, searchText, __v)', () => {
    const picked = pickPublicProductFields(fullProduct());
    expect(picked.catalogVersion).toBeUndefined();
    expect(picked.searchText).toBeUndefined();
    expect(picked.__v).toBeUndefined();
    expect(picked.contentQuality).toBeUndefined();
  });

  test('omits reduced subdocuments when the source is absent', () => {
    const picked = pickPublicProductFields({ id: 'p-2', title: 'Bare', price: 10 });
    expect(picked.provenance).toBeUndefined();
    expect(picked.publishGate).toBeUndefined();
    expect(picked.adCampaign).toBeUndefined();
  });

  test('accepts mongoose documents via toObject()', () => {
    const doc = { toObject: () => fullProduct() };
    expect(pickPublicProductFields(doc).id).toBe('p-1');
  });

  test('returns null for nullish input', () => {
    expect(pickPublicProductFields(null)).toBeNull();
    expect(pickPublicProductFields(undefined)).toBeNull();
  });
});

describe('publicProductSerializer.hasInternalProductFields', () => {
  test('trips on full internal subdocuments (leak tripwire)', () => {
    expect(hasInternalProductFields(fullProduct())).toBe(true);
  });

  test('does not trip on the reduced public projection', () => {
    expect(hasInternalProductFields(pickPublicProductFields(fullProduct()))).toBe(false);
  });

  test('trips on any pure-internal field', () => {
    for (const field of ['catalogVersion', 'ingestHash', 'searchText']) {
      expect(hasInternalProductFields({ id: 'x', [field]: 'leak' })).toBe(true);
    }
  });

  test('returns false for nullish input', () => {
    expect(hasInternalProductFields(null)).toBe(false);
  });

  test('INTERNAL_FIELD_NAMES covers the known internal surface', () => {
    for (const field of ['provenance', 'publishGate', 'adCampaign', 'catalogVersion', '__v']) {
      expect(INTERNAL_FIELD_NAMES).toContain(field);
    }
  });
});
