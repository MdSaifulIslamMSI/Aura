import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, beforeEach } from 'vitest';
import useCheckoutDraft from './useCheckoutDraft';

const INITIAL_STATE = {
    step: 1,
    contact: { name: '', phone: '', email: '' },
    shippingAddress: { address: '', city: '', postalCode: '', country: 'India' },
    deliverySlot: { date: '', window: '' },
    paymentSimulation: { status: 'idle', referenceId: '' },
};

describe('useCheckoutDraft', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('restores draft from localStorage when available', () => {
        localStorage.setItem(
            'aura_checkout_draft_user-1',
            JSON.stringify({
                step: 3,
                contact: { name: 'Ada', phone: '9999999999' },
                shippingAddress: { address: 'Line 1', city: 'Pune', postalCode: '411001', country: 'India' },
            })
        );

        const { result } = renderHook(() => useCheckoutDraft('user-1', INITIAL_STATE));
        expect(result.current.isHydrated).toBe(true);
        expect(result.current.draft.step).toBe(3);
        expect(result.current.draft.contact.name).toBe('Ada');
        expect(result.current.draft.shippingAddress.city).toBe('Pune');
    });

    test('persists updates and clears draft', () => {
        const { result } = renderHook(() => useCheckoutDraft('user-2', INITIAL_STATE));

        act(() => {
            result.current.setDraft((prev) => ({
                ...prev,
                step: 2,
                contact: { ...prev.contact, name: 'Grace' },
            }));
        });

        const stored = JSON.parse(localStorage.getItem('aura_checkout_draft_user-2'));
        expect(stored.step).toBe(2);
        expect(stored.contact.name).toBe('Grace');

        act(() => {
            result.current.clearDraft();
        });

        expect(localStorage.getItem('aura_checkout_draft_user-2')).toBeNull();
        expect(result.current.draft.step).toBe(1);
    });
});
