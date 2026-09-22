import { describe, expect, it } from 'vitest';
import { resolveAuthError } from './authErrors';

const GENERIC_TITLE = 'Something Went Wrong';

/**
 * authErrors.contract.test.js — backend/frontend message-coverage contract.
 *
 * Every core authentication/authorization failure string produced by the
 * backend (server/controllers, server/middleware) or Firebase must resolve
 * to a specific, user-actionable banner title — never the generic fallback.
 * If a new backend message falls through to "Something Went Wrong", this
 * contract fails and forces an explicit decision: add a catalog entry in
 * AUTH_ERRORS, or document the string in the intentional-generic whitelist.
 */
describe('authErrors backend coverage contract', () => {
    it.each([
        // Firebase credential failures (exact-code path)
        { code: 'auth/wrong-password', message: 'Firebase: Error (auth/wrong-password).' },
        { code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' },
        { code: 'auth/user-not-found', message: 'Firebase: Error (auth/user-not-found).' },
        { code: 'auth/too-many-requests', message: 'Firebase: Error (auth/too-many-requests).' },
        { code: 'auth/email-already-in-use', message: 'Firebase: Error (auth/email-already-in-use).' },
        { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' },
        { code: 'auth/popup-closed-by-user', message: 'Firebase: Error (auth/popup-closed-by-user).' },
        { code: 'auth/operation-not-allowed', message: 'Firebase: Error (auth/operation-not-allowed).' },
        { code: 'auth/invalid-verification-code', message: 'Firebase: Error (auth/invalid-verification-code).' },
        { code: 'auth/code-expired', message: 'Firebase: Error (auth/code-expired).' },
        { code: 'auth/quota-exceeded', message: 'Firebase: Error (auth/quota-exceeded).' },
        { code: 'auth/captcha-check-failed', message: 'Firebase: Error (auth/captcha-check-failed).' },
        { code: 'auth/account-exists-with-different-credential', message: 'Firebase: Error (auth/account-exists-with-different-credential).' },
        { code: 'auth/unauthorized-domain', message: 'Firebase: Error (auth/unauthorized-domain).' },
        { code: 'auth/error-code:-26', message: 'Firebase: Error (auth/error-code:-26).' },
        { code: 'auth/desktop-browser-sign-in-cancelled', message: 'Desktop sign-in was cancelled.' },
        {
            code: 'auth/social-invalid-credential',
            provider: 'Google',
            message: 'Firebase: Error (auth/invalid-credential).',
        },
        {
            code: 'auth/social-email-missing',
            provider: 'Google',
            message: 'Google did not provide an email address.',
        },
        // Backend 401 session failures (apiBase error shape)
        { message: 'Not authorized, token failed', status: 401 },
        { message: 'Not authorized, session expired', status: 401 },
        { message: 'Not authorized, session revoked', status: 401 },
        { message: 'Not authorized, no session', status: 401 },
        { message: 'Not authorized, no token', status: 401 },
        { message: 'Not authorized, session failed', status: 401 },
        { message: 'Your sign-in expired. Please sign in again.', status: 401 },
        // Backend account-state failures
        'Your account is not active. Contact support for account recovery.',
        'User profile missing from login database. Please sign in again to recover your account.',
        'Your account is temporarily suspended until 2026-10-01. Contact support for urgent review.',
        // Backend lockout failures: message form matches the catalog, and
        // code-shaped errors fall through to the message payload (see resolver).
        'Too many failed attempts. This account is temporarily locked. Try again later.',
        { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'Too many failed attempts. This account is temporarily locked.' },
        'Too many password reset attempts. Please wait before trying again.',
        // Backend OTP failures (anti-enumeration + specific)
        'If account details are valid, verification will proceed.',
        'No account found with this phone number',
        'Invalid OTP. Please check and try again. 2 attempt(s) remaining.',
        'OTP has expired. Please request a new one.',
        'Failed to send OTP. Please try again.',
        // Backend phone-factor / password-policy failures
        'Firebase phone verification is required before completing login.',
        'Phone number does not match your registered account.',
        'Password recovery email verification expired',
        'Unable to update password right now',
        'Passwords do not match',
        'You are already signed in',
        'No verified account found for this email and phone number. Please sign up first.',
        // DPoP / social-provider failures
        'DPoP jti replay detected',
        'Not authorized, DPoP validation failed: proof expired',
        'Google sign-in failed. Please try again.',
    ])('maps %p to a specific banner title', (rawError) => {
        const resolved = resolveAuthError(rawError);

        expect(resolved.title).toBeTruthy();
        expect(resolved.title).not.toBe(GENERIC_TITLE);
        expect(resolved.detail).toBeTruthy();
        expect(resolved.hint).toBeTruthy();
        expect(resolved.icon).toMatch(/^(clock|lock|user|wifi|shield|alert)$/);
    });

    it.each([
        // Intentional generics: 5xx detail suppression by design (errorMiddleware).
        ['backend 5xx suppression', 'Something went wrong!'],
        ['apiBase empty-body fallback', 'Request failed with status 500'],
        // Intentional generics: anti-abuse surfaces stay vague on purpose.
        ['turnstile failure', 'Human verification failed. Please refresh and try again.'],
        ['csrf rejection', 'CSRF token is invalid or expired'],
        ['otp send limiter', 'Too many OTP requests. Please wait a minute before trying again.'],
        ['session sync limiter', 'Too many session sync requests, please try again after 15 minutes'],
    ])('documents intentional-generic FALLBACK for %s (%p)', (_label, rawError) => {
        const resolved = resolveAuthError(rawError);

        expect(resolved.title).toBe(GENERIC_TITLE);
    });
});
