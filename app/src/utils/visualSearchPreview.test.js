import { describe, expect, it } from 'vitest';
import { toSafePreviewImage } from './visualSearchPreview';

describe('toSafePreviewImage', () => {
  it('allows remote http(s) and local blob previews', () => {
    expect(toSafePreviewImage('https://images.example.test/product.png')).toBe('https://images.example.test/product.png');
    expect(toSafePreviewImage('blob:https://app.example.test/id')).toBe('blob:https://app.example.test/id');
  });

  it('rejects executable and embedded preview protocols', () => {
    expect(toSafePreviewImage('javascript:alert(1)')).toBe('');
    expect(toSafePreviewImage('data:image/svg+xml,<svg onload="alert(1)"/>')).toBe('');
  });
});
