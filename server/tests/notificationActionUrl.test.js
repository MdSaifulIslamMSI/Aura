const {
  sanitizeMailtoNotificationTarget,
  sanitizeNotificationActionUrl,
  sanitizeRelativeNotificationPath,
} = require('../utils/notificationActionUrl');

describe('notificationActionUrl relative paths', () => {
  test('accepts same-app paths with queries and hashes', () => {
    expect(sanitizeRelativeNotificationPath('/orders/o-1?tab=items#top')).toBe('/orders/o-1?tab=items#top');
  });

  test('rejects absolute urls, backslashes and protocol tricks', () => {
    expect(sanitizeRelativeNotificationPath('https://evil.example/x')).toBe('');
    expect(sanitizeRelativeNotificationPath('\\windows\\path')).toBe('');
    expect(sanitizeRelativeNotificationPath('javascript:alert(1)')).toBe('');
    expect(sanitizeRelativeNotificationPath('//evil.example/x')).toBe('');
    expect(sanitizeRelativeNotificationPath('')).toBe('');
  });
});

describe('notificationActionUrl mailto targets', () => {
  test('accepts well-formed mailto links', () => {
    expect(sanitizeMailtoNotificationTarget('mailto:support@example.com')).toBe('mailto:support@example.com');
    expect(sanitizeMailtoNotificationTarget('mailto:support@example.com?subject=Help')).toBe(
      'mailto:support@example.com?subject=Help'
    );
  });

  test('rejects non-mailto schemes and empties', () => {
    expect(sanitizeMailtoNotificationTarget('https://example.com')).toBe('');
    expect(sanitizeMailtoNotificationTarget('mailto:')).toBe('');
  });
});

describe('notificationActionUrl combined sanitizer', () => {
  test('prefers relative paths, then mailto, then empty', () => {
    expect(sanitizeNotificationActionUrl('/cart')).toBe('/cart');
    expect(sanitizeNotificationActionUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(sanitizeNotificationActionUrl('https://evil.example')).toBe('');
  });
});
