import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveWindowRefresh } from './useActiveWindowRefresh';

const Probe = ({ onRefresh, intervalMs = 1000, enabled = true }) => {
    useActiveWindowRefresh(onRefresh, { enabled, intervalMs });
    return null;
};

const FocusWhenEnabledProbe = ({ onRefresh, enabled }) => {
    useActiveWindowRefresh(onRefresh, { enabled, intervalMs: 0 });

    useLayoutEffect(() => {
        if (enabled) {
            window.dispatchEvent(new Event('focus'));
        }
    }, [enabled]);

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

    it('does not miss focus when refresh becomes enabled in the same commit', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(
            <FocusWhenEnabledProbe onRefresh={onRefresh} enabled={false} />
        );

        await act(async () => {
            rerender(<FocusWhenEnabledProbe onRefresh={onRefresh} enabled />);
            await Promise.resolve();
        });

        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});
