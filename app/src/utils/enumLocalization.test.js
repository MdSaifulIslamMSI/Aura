import { describe, expect, it } from 'vitest';
import { humanizeEnumLabel, normalizeEnumToken } from './enumLocalization';

describe('enumLocalization', () => {
    it('normalizes enum-like values into stable tokens', () => {
        expect(normalizeEnumToken('moderation_appeal')).toBe('moderation_appeal');
        expect(normalizeEnumToken('payment.capture.failed')).toBe('payment_capture_failed');
        expect(normalizeEnumToken('orderStatusUpdated')).toBe('order_status_updated');
    });

    it('humanizes enum labels into readable copy', () => {
        expect(humanizeEnumLabel('moderation_appeal')).toBe('Moderation Appeal');
        expect(humanizeEnumLabel('payment.capture.failed')).toBe('Payment Capture Failed');
        expect(humanizeEnumLabel('otp_code')).toBe('OTP Code');
    });
});
