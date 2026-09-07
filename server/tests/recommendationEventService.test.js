jest.mock('../models/RecommendationEvent', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../services/candidateService', () => ({ resolveProductByIdentifier: jest.fn() }));

const RecommendationEvent = require('../models/RecommendationEvent');
const { resolveProductByIdentifier } = require('../services/candidateService');
const {
  recordRecommendationEvent,
  resolveProductReference,
} = require('../services/recommendationEventService');

const chainLean = (resolved) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(resolved) }) });

describe('recommendationEventService.resolveProductReference', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns nulls for blank identifiers', async () => {
    await expect(resolveProductReference('')).resolves.toEqual({ productId: null, productNumericId: null });
    expect(resolveProductByIdentifier).not.toHaveBeenCalled();
  });

  test('prefers catalog resolution over raw parsing', async () => {
    resolveProductByIdentifier.mockResolvedValue({ _id: 'mongo-1', id: 42 });
    await expect(resolveProductReference('phone')).resolves.toEqual({ productId: 'mongo-1', productNumericId: 42 });
  });

  test('falls back to ObjectId and numeric parsing', async () => {
    resolveProductByIdentifier.mockResolvedValue(null);
    await expect(resolveProductReference('507f1f77bcf86cd799439011')).resolves.toEqual({
      productId: '507f1f77bcf86cd799439011', productNumericId: null,
    });
    await expect(resolveProductReference('101')).resolves.toEqual({ productId: null, productNumericId: 101 });
  });
});

describe('recommendationEventService.recordRecommendationEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects unknown event types with 400', async () => {
    await expect(recordRecommendationEvent({ eventType: 'mind_read', sessionId: 's-1' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(RecommendationEvent.create).not.toHaveBeenCalled();
  });

  test('requires a session for guest events', async () => {
    await expect(recordRecommendationEvent({ eventType: 'add_to_cart' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('dedupes repeat impressions within the window', async () => {
    resolveProductByIdentifier.mockResolvedValue(null);
    RecommendationEvent.findOne.mockReturnValue(chainLean({ _id: 'evt-old' }));
    const result = await recordRecommendationEvent({
      eventType: 'recommendation_impression', productId: '101', sessionId: 's-1', sourcePage: 'cart',
    });
    expect(result).toEqual({ event: { _id: 'evt-old' }, deduped: true });
    expect(RecommendationEvent.create).not.toHaveBeenCalled();
  });

  test('persists sanitized events with truncated fields', async () => {
    resolveProductByIdentifier.mockResolvedValue(null);
    RecommendationEvent.findOne.mockReturnValue(chainLean(null));
    RecommendationEvent.create.mockResolvedValue({ _id: 'evt-new' });

    const result = await recordRecommendationEvent({
      userId: 'u-1', eventType: 'add_to_cart', productId: '101',
      searchQuery: 'x'.repeat(500), category: 'y'.repeat(200), metadata: ['not-an-object'],
    });
    expect(result.deduped).toBe(false);
    expect(RecommendationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u-1',
      sessionId: 'user-u-1',
      searchQuery: expect.any(String),
      metadata: {},
    }));
    expect(RecommendationEvent.create.mock.calls[0][0].searchQuery).toHaveLength(400);
    expect(RecommendationEvent.create.mock.calls[0][0].category).toHaveLength(120);
  });
});
