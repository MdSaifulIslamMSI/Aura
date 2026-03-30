import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    clearAuthIdentityMemory,
    clearAuthJourneyDraft,
    describeAccelerationLane,
    readAuthIdentityMemory,
    readAuthJourneyDraft,
    writeAuthIdentityMemory,
    writeAuthJourneyDraft,
} from './authAcceleration';

describe('authAcceleration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    test('restores a safe signup OTP draft when the OTP can continue', () => {
        writeAuthJourneyDraft({
            mode: 'signup',
            step: 'otp',
            email: 'Test@Example.com',
            phone: '+91 98765 43210',
            otpStage: 'single',
            otpTransport: 'backend_otp',
            countdown: 44,
        });

        const draft = readAuthJourneyDraft();
        expect(draft).toMatchObject({
            mode: 'signup',
            step: 'otp',
            email: 'test@example.com',
            phone: '+919876543210',
            canResumeOtp: true,
            countdown: 44,
        });
        expect(draft.resumeMessage.title).toBe('Verification ready');
    });

    test('downgrades sign-in OTP drafts to the form because secrets are not persisted', () => {
        writeAuthJourneyDraft({
            mode: 'signin',
            step: 'otp',
            email: 'returning@example.com',
            phone: '+919876543210',
            otpStage: 'single',
            otpTransport: 'backend_otp',
            countdown: 50,
        });

        const draft = readAuthJourneyDraft();
        expect(draft).toMatchObject({
            mode: 'signin',
            step: 'form',
            canResumeOtp: false,
            countdown: 0,
        });
        expect(draft.resumeMessage.detail).toContain('Re-enter your password');
    });

    test('expires stale auth journey drafts', () => {
        writeAuthJourneyDraft({
            mode: 'forgot-password',
            step: 'form',
            email: 'recover@example.com',
            phone: '+919876543210',
        });

        vi.advanceTimersByTime(16 * 60 * 1000);

        expect(readAuthJourneyDraft()).toBeNull();
    });

    test('stores identity memory with masking and provider hints', () => {
        writeAuthIdentityMemory({
            email: 'returning@example.com',
            phone: '+919876543210',
            providerIds: ['password', 'google.com'],
            assuranceLevel: 'password+otp',
            assuranceLabel: 'Strong verification',
            displayName: 'Returning User',
        });

        const memory = readAuthIdentityMemory();
        expect(memory).toMatchObject({
            email: 'returning@example.com',
            phone: '+919876543210',
            maskedEmail: 're***@example.com',
            assuranceLabel: 'Strong verification',
            providerLabel: 'Google-ready',
            displayName: 'Returning User',
        });
    });

    test('describes the fastest available lane for social sign-in hosts', () => {
        expect(describeAccelerationLane({
            mode: 'signin',
            socialAuthSupported: true,
            canUseFirebasePhoneOtp: true,
        })).toMatchObject({
            title: 'Instant return lanes',
        });
    });

    test('clears stored state explicitly', () => {
        writeAuthJourneyDraft({
            mode: 'signup',
            step: 'form',
            email: 'clear-me@example.com',
        });
        writeAuthIdentityMemory({
            email: 'clear-me@example.com',
        });

        clearAuthJourneyDraft();
        clearAuthIdentityMemory();

        expect(readAuthJourneyDraft()).toBeNull();
        expect(readAuthIdentityMemory()).toBeNull();
    });
});

