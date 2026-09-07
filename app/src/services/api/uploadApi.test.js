import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('./apiUtils', () => ({ getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer t' })) }));

import { apiFetch } from '../apiBase';
import { uploadApi } from './uploadApi';

const makeFile = (overrides = {}) => ({
  name: 'review.jpg',
  type: 'image/jpeg',
  size: 2048,
  ...overrides,
});

const stubFileReader = (result) => {
  const reader = {
    result,
    readAsDataURL: null,
    onload: null,
    onerror: null,
  };
  reader.readAsDataURL = vi.fn(() => { reader.onload(); });
  vi.stubGlobal('FileReader', vi.fn(function () { return reader; }));
  return reader;
};

describe('uploadApi review media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('signs uploads with file metadata as JSON', async () => {
    apiFetch.mockResolvedValue({ data: { uploadToken: 'tok' } });
    await uploadApi.signReviewMediaUpload({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 });
    expect(apiFetch).toHaveBeenCalledWith('/uploads/reviews/sign', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 });
  });

  it('converts files to data URLs before uploading', async () => {
    stubFileReader('data:image/jpeg;base64,AAA');
    apiFetch.mockResolvedValue({ data: { ok: true } });
    await uploadApi.uploadSignedReviewMedia({ uploadToken: 'tok-1', file: makeFile() });
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      uploadToken: 'tok-1',
      fileName: 'review.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AAA',
    });
  });

  it('falls back to default file metadata when absent', async () => {
    stubFileReader('data:,x');
    apiFetch.mockResolvedValue({ data: {} });
    await uploadApi.uploadSignedReviewMedia({ uploadToken: 'tok-1', file: {} });
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ fileName: 'review-media', mimeType: '' });
  });

  it('orchestrates sign-then-upload from a single file', async () => {
    stubFileReader('data:image/jpeg;base64,AAA');
    apiFetch
      .mockResolvedValueOnce({ data: { uploadToken: 'tok-9' } })
      .mockResolvedValueOnce({ data: { ok: true } });
    const result = await uploadApi.uploadReviewMediaFromFile(makeFile({ size: 99 }));
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ fileName: 'review.jpg', sizeBytes: 99 });
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toMatchObject({ uploadToken: 'tok-9' });
  });

  it('surfaces FileReader failures instead of uploading', async () => {
    const reader = { result: null, readAsDataURL: null, onload: null, onerror: null };
    reader.readAsDataURL = vi.fn(() => { reader.onerror(); });
    vi.stubGlobal('FileReader', vi.fn(function () { return reader; }));
    apiFetch.mockResolvedValue({ data: {} });
    await expect(uploadApi.uploadSignedReviewMedia({ uploadToken: 't', file: makeFile() }))
      .rejects.toThrow('Failed to read file for upload');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
