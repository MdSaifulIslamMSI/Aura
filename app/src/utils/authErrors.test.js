import { describe, expect, it } from 'vitest';
import { resolveAuthError } from './authErrors';

describe('resolveAuthError', () => {
    it('keeps password invalid-credential errors mapped to password guidance', () => {
        const resolved = resolveAuthError({ code: 'auth/invalid-credential' });

        expect(resolved.title).toBe('Invalid Credentials');
        expect(resolved.detail).toBe('Email or password is incorrect.');
    });

    it('maps social invalid-credential errors away from password guidance', () => {
        const resolved = resolveAuthError({
            code: 'auth/invalid-credential',
            provider: 'X',
            message: 'Firebase: Error (auth/invalid-credential).',
        });

        expect(resolved.title).toBe('X Sign-In Failed');
        expect(resolved.detail).toContain("couldn't complete X authentication");
        expect(resolved.hint).toContain('callback URL');
    });

    it('explains account collisions for social providers', () => {
        const resolved = resolveAuthError({
            code: 'auth/account-exists-with-different-credential',
            provider: 'twitter.com',
            email: 'user@example.com',
        });

        expect(resolved.title).toBe('X Account Already Exists');
        expect(resolved.detail).toContain('user@example.com');
        expect(resolved.action).toBe('signin');
    });

    it('explains missing email access for social providers', () => {
        const resolved = resolveAuthError({
            code: 'auth/social-email-missing',
            provider: 'X',
            message: 'Social account did not provide an email.',
        });

        expect(resolved.title).toBe('X Email Access Required');
        expect(resolved.detail).toContain('did not return an email address');
    });

    it('explains native mobile OAuth configuration gaps without blaming the password', () => {
        const resolved = resolveAuthError({
            code: 'auth/native-social-auth-configuration-missing',
            provider: 'Google',
        });

        expect(resolved.title).toBe('Mobile Social Sign-In Not Ready');
        expect(resolved.hint).toContain('Use email and OTP sign-in');
    });

    it('recognizes backend email-missing failures during social session bootstrap', () => {
        const resolved = resolveAuthError({
            provider: 'twitter.com',
            message: 'CSRF token fetch failed for /auth/sync: HTTP 401: Authenticated account is missing email. Please refresh and try again.',
        });

        expect(resolved.title).toBe('X Email Access Required');
        expect(resolved.detail).toContain('did not return an email address');
    });

    it('explains masked backend 500s during social session bootstrap', () => {
        const resolved = resolveAuthError({
            code: 'auth/social-session-sync-failed',
            provider: 'Google',
            status: 500,
            message: 'Something went wrong!',
            serverRequestId: 'req-social-sync-1',
        });

        expect(resolved.title).toBe('Google Sign-In Needs Retry');
        expect(resolved.detail).toContain('could not finish opening your marketplace session');
        expect(resolved.hint).toContain('req-social-sync-1');
    });

    it('prefers nested message strings over object coercion', () => {
        const resolved = resolveAuthError({
            message: {
                message: 'Google sign-in could not be completed.',
            },
        });

        expect(resolved.title).toBe('Something Went Wrong');
        expect(resolved.detail).toBe('Google sign-in could not be completed.');
    });

    it('falls back to nested error arrays without rendering object placeholders', () => {
        const resolved = resolveAuthError({
            data: {
                errors: [
                    { message: 'Trusted device verification required for this action.' },
                ],
            },
        });

        expect(resolved.detail).toBe('Trusted device verification required for this action.');
    });

    it('does not crash when the raw auth error message is an object', () => {
        const resolved = resolveAuthError({
            code: null,
            message: { reason: 'Email verification is required before session sync' },
        });

        expect(resolved).toBeTruthy();
        expect(resolved.title).toBeDefined();
        expect(typeof resolved.title).toBe('string');
    });
});
