const { signReviewUploadSchema, uploadReviewMediaSchema } = require('../validators/uploadValidators');

describe('uploadValidators.signReviewUploadSchema', () => {
  const valid = { body: { fileName: 'review.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 } };

  test('accepts a well-formed sign request', () => {
    expect(() => signReviewUploadSchema.parse(valid)).not.toThrow();
  });

  test('rejects blank file names', () => {
    const result = signReviewUploadSchema.safeParse({ body: { ...valid.body, fileName: '   ' } });
    expect(result.success).toBe(false);
  });

  test('rejects oversized payloads above 15MB', () => {
    const result = signReviewUploadSchema.safeParse({
      body: { ...valid.body, sizeBytes: 16 * 1024 * 1024 },
    });
    expect(result.success).toBe(false);
  });

  test('coerces string sizes and rejects non-positive values', () => {
    expect(signReviewUploadSchema.parse({ body: { ...valid.body, sizeBytes: '2048' } }).body.sizeBytes).toBe(2048);
    expect(signReviewUploadSchema.safeParse({ body: { ...valid.body, sizeBytes: 0 } }).success).toBe(false);
  });

  test('rejects unknown body fields (strict mode)', () => {
    const result = signReviewUploadSchema.safeParse({ body: { ...valid.body, evil: 'x' } });
    expect(result.success).toBe(false);
  });
});

describe('uploadValidators.uploadReviewMediaSchema', () => {
  const valid = {
    body: {
      uploadToken: 'a'.repeat(32),
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      dataUrl: `data:video/mp4;base64,${'a'.repeat(64)}`,
    },
  };

  test('accepts a well-formed upload request', () => {
    expect(() => uploadReviewMediaSchema.parse(valid)).not.toThrow();
  });

  test('rejects short upload tokens (forgery guard)', () => {
    const result = uploadReviewMediaSchema.safeParse({ body: { ...valid.body, uploadToken: 'short' } });
    expect(result.success).toBe(false);
  });

  test('rejects tiny data URLs that cannot carry media', () => {
    const result = uploadReviewMediaSchema.safeParse({ body: { ...valid.body, dataUrl: 'data:,x' } });
    expect(result.success).toBe(false);
  });

  test('rejects oversized data URLs above 20MB', () => {
    const result = uploadReviewMediaSchema.safeParse({
      body: { ...valid.body, dataUrl: `data:image/jpeg;base64,${'a'.repeat(21 * 1024 * 1024)}` },
    });
    expect(result.success).toBe(false);
  });

  test('rejects unknown body fields (strict mode)', () => {
    const result = uploadReviewMediaSchema.safeParse({ body: { ...valid.body, isAdmin: true } });
    expect(result.success).toBe(false);
  });
});
