import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveWindowRefresh } from './useActiveWindowRefresh';

const Probe = ({ onRefresh, intervalMs = 1000, enabled = true }) => {
    useActiveWindowRefresh(onRefresh, { enabled, intervalMs });
    return null;
};

describe('useActiveWindowRefresh', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('revalidates on focus and on the configured interval', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);

        render(<Probe onRefresh={onRefresh} />);

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });

        expect(onRefresh).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(1000);
            await Promise.resolve();
        });

        expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it('dedupes overlapping refresh attempts until the current one settles', async () => {
        let resolveRefresh;
        const onRefresh = vi.fn().mockImplementation(
            () => new Promise((resolve) => {
                resolveRefresh = resolve;
            })
        );

        render(<Probe onRefresh={onRefresh} intervalMs={0} />);

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });

        expect(onRefresh).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveRefresh();
            await Promise.resolve();
        });

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });

        expect(onRefresh).toHaveBeenCalledTimes(2);
    });
});
