import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ACCOUNT_TELEMETRY_EVENTS,
    __private,
    trackAccountEvent,
} from './accountTelemetry';
import { pushClientDiagnostic } from './clientObservability';

vi.mock('./clientObservability', () => ({
    pushClientDiagnostic: vi.fn((type, payload, severity) => ({ type, ...payload, severity })),
}));

describe('accountTelemetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('emits only the typed allowlisted fields for a profile event', () => {
        const event = trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.PROFILE_UPDATED, {
            changedFields: ['name', 'phone', 'email', 'name'],
            email: 'person@example.com',
            token: 'must-not-leave-the-browser',
        });

        expect(event).toMatchObject({
            type: 'account.profile_updated',
            severity: 'info',
            context: {
                changedFields: ['name', 'phone'],
            },
        });
        expect(pushClientDiagnostic).toHaveBeenCalledWith(
            'account.profile_updated',
            { context: { changedFields: ['name', 'phone'] } },
            'info'
        );
        expect(JSON.stringify(event)).not.toContain('person@example.com');
        expect(JSON.stringify(event)).not.toContain('must-not-leave-the-browser');
    });

    it('rejects unknown events and invalid bounded contexts', () => {
        expect(trackAccountEvent('account.email_captured', { email: 'person@example.com' })).toBeNull();
        expect(trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.SESSION_REVOKED, {
            scope: 'session-secret-value',
        })).toBeNull();
        expect(pushClientDiagnostic).not.toHaveBeenCalled();
    });

    it('buckets counts and rates Core Web Vitals without identifiers', () => {
        expect(__private.getItemCountBucket(1)).toBe('1');
        expect(__private.getItemCountBucket(4)).toBe('2-5');
        expect(__private.getItemCountBucket(10)).toBe('6+');
        expect(__private.rateWebVital('LCP', 2400)).toBe('good');
        expect(__private.rateWebVital('INP', 350)).toBe('needs_improvement');
        expect(__private.rateWebVital('CLS', 0.3)).toBe('poor');
    });
});
