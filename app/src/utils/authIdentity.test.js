import { describe, expect, it } from 'vitest';
import { getUserVisibleEmail, isInternalAuthEmail, normalizeEmail } from './authIdentity';

describe('authIdentity', () => {
    it('normalizes emails by trimming and lowercasing', () => {
        expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
        expect(normalizeEmail('A@B.C')).toBe('a@b.c');
    });

    it('returns an empty string for non-string inputs', () => {
        expect(normalizeEmail(undefined)).toBe('');
        expect(normalizeEmail(null)).toBe('');
        expect(normalizeEmail(42)).toBe('');
        expect(normalizeEmail({ email: 'a@b.c' })).toBe('');
    });

    it('detects internal auth emails regardless of case or padding', () => {
        expect(isInternalAuthEmail('someone@auth.aura.invalid')).toBe(true);
        expect(isInternalAuthEmail('  SOMEONE@Auth.Aura.Invalid ')).toBe(true);
    });

    it('rejects lookalike domains and empty values', () => {
        expect(isInternalAuthEmail('someone@notauth.aura.invalid')).toBe(false);
        expect(isInternalAuthEmail('someone@aura.invalid')).toBe(false);
        expect(isInternalAuthEmail('auth.aura.invalid')).toBe(false);
        expect(isInternalAuthEmail('')).toBe(false);
        expect(isInternalAuthEmail(null)).toBe(false);
    });

    it('hides internal auth emails from the user while keeping real ones visible', () => {
        expect(getUserVisibleEmail('dev@auth.aura.invalid')).toBe('');
        expect(getUserVisibleEmail('  Shopper@Flipkart.COM ')).toBe('shopper@flipkart.com');
        expect(getUserVisibleEmail(undefined)).toBe('');
    });
});
