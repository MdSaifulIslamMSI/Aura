const {
    sanitizeMailtoNotificationTarget,
    sanitizeNotificationActionUrl,
    sanitizeRelativeNotificationPath,
} = require('../utils/notificationActionUrl');

describe('notificationActionUrl', () => {
    test('keeps safe relative notification paths', () => {
        expect(sanitizeRelativeNotificationPath('/profile?tab=notifications')).toBe('/profile?tab=notifications');
        expect(sanitizeNotificationActionUrl('/profile?tab=support&ticket=123')).toBe('/profile?tab=support&ticket=123');
    });

    test('rejects external and protocol-relative redirects', () => {
        expect(sanitizeNotificationActionUrl('https://evil.example/phish')).toBe('');
        expect(sanitizeNotificationActionUrl('//evil.example/phish')).toBe('');
        expect(sanitizeNotificationActionUrl('javascript:alert(1)')).toBe('');
    });

    test('preserves explicit mailto support actions', () => {
        expect(sanitizeMailtoNotificationTarget('mailto:support@example.com?subject=Help')).toBe(
            'mailto:support@example.com?subject=Help'
        );
    });
});
