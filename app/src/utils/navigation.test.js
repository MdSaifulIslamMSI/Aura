import { describe, expect, it } from 'vitest';
import { resolveNavigationTarget } from './navigation';

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
});
