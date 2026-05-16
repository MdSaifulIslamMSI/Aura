import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emergencyApi } from '@/services/api';
import { EmergencyStatusProvider, useEmergencyStatus } from './EmergencyStatusContext';

vi.mock('@/services/api', () => ({
    emergencyApi: {
        getStatus: vi.fn(),
    },
}));

const Probe = () => {
    const status = useEmergencyStatus();
    return (
        <div>
            <div data-testid="features">{status.disabledFeatures.join(',')}</div>
            <div data-testid="banner">{status.bannerMessage}</div>
            <div data-testid="payment-disabled">{String(status.isFeatureDisabled('payment'))}</div>
            <div data-testid="loading">{String(status.loading)}</div>
        </div>
    );
};

const flushProviderSettled = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('EmergencyStatusProvider', () => {
    let intervalCallback;

    beforeEach(() => {
        intervalCallback = null;
        vi.spyOn(window, 'setInterval').mockImplementation((callback, timeout) => {
            if (timeout === 45_000) {
                intervalCallback = callback;
            }
            return 123;
        });
        vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
        emergencyApi.getStatus.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches on load, polls, refetches on focus, and refetches after emergency responses', async () => {
        emergencyApi.getStatus
            .mockResolvedValueOnce({
                maintenance: false,
                readOnly: false,
                disabledFeatures: ['payment'],
                bannerMessage: 'Payments paused',
                timestamp: '2026-05-15T00:00:00.000Z',
            })
            .mockResolvedValueOnce({
                maintenance: false,
                readOnly: true,
                disabledFeatures: ['checkout'],
                bannerMessage: 'Read only',
                timestamp: '2026-05-15T00:00:45.000Z',
            })
            .mockResolvedValueOnce({
                maintenance: false,
                readOnly: false,
                disabledFeatures: ['ai'],
                bannerMessage: 'Assistant paused',
                timestamp: '2026-05-15T00:01:00.000Z',
            })
            .mockResolvedValueOnce({
                maintenance: true,
                readOnly: false,
                disabledFeatures: [],
                bannerMessage: 'Maintenance',
                timestamp: '2026-05-15T00:01:01.000Z',
            });

        render(
            <EmergencyStatusProvider>
                <Probe />
            </EmergencyStatusProvider>
        );

        await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('Payments paused'));
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
        expect(screen.getByTestId('payment-disabled')).toHaveTextContent('true');
        expect(emergencyApi.getStatus).toHaveBeenCalledTimes(1);

        await act(async () => {
            intervalCallback();
        });
        await waitFor(() => expect(emergencyApi.getStatus).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByTestId('features')).toHaveTextContent('checkout'));
        await flushProviderSettled();

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        await waitFor(() => expect(emergencyApi.getStatus).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.getByTestId('features')).toHaveTextContent('ai'));
        await flushProviderSettled();

        await act(async () => {
            window.dispatchEvent(new CustomEvent('aura:emergency-status:refresh', {
                detail: { code: 'READ_ONLY_MODE', requestId: 'req-frontend' },
            }));
            await Promise.resolve();
        });
        await waitFor(() => expect(emergencyApi.getStatus).toHaveBeenCalledTimes(4));
        await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('Maintenance'));
    });
});
