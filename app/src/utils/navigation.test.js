import { describe, expect, it } from 'vitest';
import { resolveNavigationTarget, resolveNotificationActionTarget } from './navigation';

describe('resolveNavigationTarget', () => {
    it('preserves pathname, search, and hash from router state', () => {
        expect(resolveNavigationTarget({
            pathname: '/profile',
            search: '?tab=support&compose=1',
            hash: '#reply',
        })).toBe('/profile?tab=support&compose=1#reply');
    });

    it('falls back safely when no pathname is available', () => {
        expect(resolveNavigationTarget(null, '/')).toBe('/');
        expect(resolveNavigationTarget({}, '/login')).toBe('/login');
    });

    it('rejects external string targets and falls back to the default path', () => {
        expect(resolveNavigationTarget('https://evil.example/phish', '/')).toBe('/');
        expect(resolveNavigationTarget('javascript:alert(1)', '/login')).toBe('/login');
    });
});

describe('resolveNotificationActionTarget', () => {
    it('accepts safe relative notification destinations', () => {
        expect(resolveNotificationActionTarget('/profile?tab=notifications')).toEqual({
            kind: 'internal',
            href: '/profile?tab=notifications',
        });
    });

    it('accepts same-origin absolute notification destinations when the origin is trusted', () => {
        expect(resolveNotificationActionTarget(
            'https://aura.example/profile?tab=support&ticket=123',
            { origin: 'https://aura.example' },
        )).toEqual({
            kind: 'internal',
            href: '/profile?tab=support&ticket=123',
        });
    });

    it('rejects off-origin notification redirects', () => {
        expect(resolveNotificationActionTarget(
            'https://evil.example/profile?tab=notifications',
            { origin: 'https://aura.example' },
        )).toBeNull();
        expect(resolveNotificationActionTarget('//evil.example/landing')).toBeNull();
    });

    it('preserves mailto notification actions for support flows', () => {
        expect(resolveNotificationActionTarget('mailto:support@example.com?subject=Help')).toEqual({
            kind: 'external',
            href: 'mailto:support@example.com?subject=Help',
        });
    });
});
