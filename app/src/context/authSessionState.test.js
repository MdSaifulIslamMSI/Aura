import { describe, expect, test } from 'vitest';
import {
    buildFirebaseSessionFallback,
    buildSessionStateFromPayload,
    isAuthenticatedSessionStatus,
    normalizeEmail,
    normalizePhone,
    normalizeSessionStatus,
    SESSION_STATUS,
} from './authSessionState';

describe('authSessionState', () => {
    test('normalizes session status values and upgrades the legacy lattice challenge label', () => {
        expect(normalizeSessionStatus('lattice_challenge_required')).toBe(SESSION_STATUS.DEVICE_CHALLENGE);
        expect(normalizeSessionStatus('authenticated')).toBe(SESSION_STATUS.AUTHENTICATED);
        expect(normalizeSessionStatus('unexpected')).toBe(SESSION_STATUS.SIGNED_OUT);
    });

    test('treats only a resolved authenticated session as fully authenticated', () => {
        expect(isAuthenticatedSessionStatus(SESSION_STATUS.AUTHENTICATED)).toBe(true);
        expect(isAuthenticatedSessionStatus(SESSION_STATUS.LOADING)).toBe(false);
        expect(isAuthenticatedSessionStatus(SESSION_STATUS.DEVICE_CHALLENGE)).toBe(false);
        expect(isAuthenticatedSessionStatus(SESSION_STATUS.RECOVERABLE_ERROR)).toBe(false);
        expect(isAuthenticatedSessionStatus('lattice_challenge_required')).toBe(false);
    });

    test('builds a Firebase session fallback with normalized identity fields', () => {
        const session = buildFirebaseSessionFallback({
            uid: ' user-1 ',
            email: 'User@Example.com ',
            emailVerified: true,
            displayName: ' Test User ',
            phoneNumber: '+91 98765 43210',
            providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
        });

        expect(session).toEqual({
            uid: 'user-1',
            email: 'user@example.com',
            emailVerified: true,
            displayName: 'Test User',
            phone: '+919876543210',
            providerIds: ['password', 'google.com'],
            authTime: null,
            issuedAt: null,
            expiresAt: null,
        });
    });

    test('builds a complete fallback session state when only Firebase identity is available', () => {
        const sessionState = buildSessionStateFromPayload({}, {
            uid: 'user-2',
            email: 'device@example.com',
            emailVerified: true,
            displayName: 'Device User',
            phoneNumber: '+1 (415) 555-0100',
            providerData: [{ providerId: 'google.com' }],
        });

        expect(sessionState.status).toBe(SESSION_STATUS.AUTHENTICATED);
        expect(sessionState.roles.isVerified).toBe(true);
        expect(sessionState.intelligence.assurance.level).toBe('password');
        expect(sessionState.intelligence.acceleration.suggestedRoute).toBe('social');
        expect(sessionState.session.phone).toBe('+14155550100');
    });

    test('keeps exported identity normalizers aligned with AuthContext expectations', () => {
        expect(normalizeEmail(' MixedCase@Example.com ')).toBe('mixedcase@example.com');
        expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    });
});
