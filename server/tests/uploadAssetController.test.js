jest.mock('../services/reviewMediaStorageService', () => ({
  buildReviewMediaStorageKey: jest.fn((p) => `reviews/${p}`),
  getReviewMediaObject: jest.fn(),
}));
jest.mock('../services/avatarMediaStorageService', () => ({ getAvatarMediaObject: jest.fn() }));

const { getReviewMediaObject } = require('../services/reviewMediaStorageService');
const { getAvatarMediaObject } = require('../services/avatarMediaStorageService');
const {
  serveAvatarMediaAsset,
  serveReviewMediaAsset,
} = require('../controllers/uploadAssetController');

const mockReqRes = (param0 = '') => {
  const req = { params: { 0: param0 } };
  const res = { setHeader: jest.fn(), end: jest.fn(), on: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
};

describe('uploadAssetController path safety', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['empty path', ''],
    ['blank path', '   '],
    ['traversal', '../secrets/env'],
    ['nested traversal', 'a/../../b'],
    ['absolute path', '/etc/passwd'],
    ['illegal chars', 'a b;c$d'],
  ])('rejects %s with 404', async (_label, path) => {
    const { req, res, next } = mockReqRes(path);
    await serveReviewMediaAsset(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
    expect(getReviewMediaObject).not.toHaveBeenCalled();
  });

  test('maps missing storage objects to 404 across providers', async () => {
    for (const error of [
      { code: 404 }, { $metadata: { httpStatusCode: 404 } }, { name: 'NoSuchKey' }, { Code: 'NoSuchKey' },
    ]) {
      getReviewMediaObject.mockRejectedValueOnce(error);
      const { req, res, next } = mockReqRes('2026/img.png');
      await serveReviewMediaAsset(req, res, next);
      expect(next.mock.calls.at(-1)[0].statusCode).toBe(404);
    }
  });

  test('forwards unexpected storage failures to the error handler', async () => {
    getReviewMediaObject.mockRejectedValueOnce(new Error('S3 down'));
    const { req, res, next } = mockReqRes('2026/img.png');
    await serveReviewMediaAsset(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'S3 down' }));
    expect(res.end).not.toHaveBeenCalled();
  });
});

describe('uploadAssetController response shaping', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets security and cache headers with buffer bodies', async () => {
    getReviewMediaObject.mockResolvedValue({
      contentType: 'image/png',
      contentLength: 4,
      etag: '"abc"',
      lastModified: '2026-09-01T00:00:00.000Z',
      body: Buffer.from([1, 2, 3, 4]),
    });
    const { req, res, next } = mockReqRes('2026/img.png');
    await serveReviewMediaAsset(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4');
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"abc"');
    expect(res.end).toHaveBeenCalledWith(expect.any(Buffer));
    expect(next).not.toHaveBeenCalled();
  });

  test('defaults cache control when the object omits it', async () => {
    getReviewMediaObject.mockResolvedValue({ body: Buffer.from([9]) });
    const { req, res } = mockReqRes('2026/img.png');
    await serveReviewMediaAsset(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
  });

  test('supports byte-array bodies and rejects unknown types', async () => {
    getReviewMediaObject.mockResolvedValueOnce({
      body: { transformToByteArray: async () => new Uint8Array([7, 8]) },
    });
    const first = mockReqRes('2026/a.png');
    await serveReviewMediaAsset(first.req, first.res, jest.fn());
    expect(first.res.end).toHaveBeenCalledWith(expect.any(Buffer));

    getReviewMediaObject.mockResolvedValueOnce({ body: { weird: true } });
    const second = mockReqRes('2026/b.png');
    await serveReviewMediaAsset(second.req, second.res, second.next);
    expect(second.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unsupported upload body type' }));
  });

  test('serves avatar assets with nosniff hardening', async () => {
    getAvatarMediaObject.mockResolvedValue({ body: Buffer.from([1]) });
    const { req, res, next } = mockReqRes('u1abcd.webp');
    await serveAvatarMediaAsset(req, res, next);
    expect(getAvatarMediaObject).toHaveBeenCalledWith({ storageKey: 'u1abcd.webp' });
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects non-webp avatar keys with 404', async () => {
    for (const bad of ['avatars/u1.png', '../x.webp', 'a.jpg']) {
      const { req, res, next } = mockReqRes(bad);
      await serveAvatarMediaAsset(req, res, next);
      expect(next.mock.calls.at(-1)[0].statusCode).toBe(404);
    }
    expect(getAvatarMediaObject).not.toHaveBeenCalled();
  });
});
