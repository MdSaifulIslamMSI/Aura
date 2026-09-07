jest.mock('../models/SearchEvent', () => ({
  create: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
}));

const SearchEvent = require('../models/SearchEvent');
const {
  buildSearchTelemetrySummary,
  recordSearchClick,
  recordSearchResults,
} = require('../services/searchTelemetryService');

const req = { requestId: 'req-1', ip: '127.0.0.1', headers: {}, user: { _id: 'u-1' } };

describe('searchTelemetryService.recordSearchResults', () => {
  beforeEach(() => jest.clearAllMocks());

  test('persists normalized result events', async () => {
    SearchEvent.create.mockResolvedValue({ eventId: 'srch-1', toObject: () => ({ eventId: 'srch-1' }) });
    const doc = await recordSearchResults({
      req, query: { keyword: '  Phone ', category: 'phones' }, products: [{ id: 1 }, { _id: 'a' }],
    });
    expect(doc).toEqual({ eventId: 'srch-1' });
    expect(SearchEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'search_results', queryText: 'Phone',
    }));
    const resultIds = SearchEvent.create.mock.calls[0][0].resultIds;
    expect(resultIds.length).toBeGreaterThan(0);
  });

  test('handles empty result sets', async () => {
    SearchEvent.create.mockResolvedValue({ toObject: () => ({}) });
    await recordSearchResults({ req, query: { q: 'zzz' }, products: [] });
    expect(SearchEvent.create).toHaveBeenCalledWith(expect.objectContaining({ resultIds: [] }));
  });
});

describe('searchTelemetryService.recordSearchClick', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requires a product id', async () => {
    await expect(recordSearchClick({ req, productId: '   ' })).rejects.toThrow('productId is required');
    expect(SearchEvent.create).not.toHaveBeenCalled();
  });

  test('persists click events with positions', async () => {
    SearchEvent.create.mockResolvedValue({ eventId: 'sclk-1', toObject: () => ({ eventId: 'sclk-1' }) });
    await recordSearchClick({ req, searchEventId: 'srch-1', productId: 'p-9', position: 3 });
    expect(SearchEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'search_click', searchEventId: 'srch-1',
    }));
  });
});

describe('searchTelemetryService.buildSearchTelemetrySummary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aggregates counts and top queries over the window', async () => {
    SearchEvent.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
    SearchEvent.aggregate.mockResolvedValue([{ _id: 'phone', count: 6, zeroResults: 1 }]);
    const summary = await buildSearchTelemetrySummary({ windowHours: 24 });
    expect(SearchEvent.countDocuments).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ generatedAt: expect.any(String) });
  });

  test('clamps invalid windows to sane defaults', async () => {
    SearchEvent.countDocuments.mockResolvedValue(0);
    SearchEvent.aggregate.mockResolvedValue([]);
    await buildSearchTelemetrySummary({ windowHours: -5 });
    const since = SearchEvent.countDocuments.mock.calls[0][0].createdAt.$gte;
    expect(Date.now() - since.getTime()).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
  });
});
