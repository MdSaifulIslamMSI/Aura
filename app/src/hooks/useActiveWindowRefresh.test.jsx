import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { DEFAULT_ACTIVE_WINDOW_REFRESH_INTERVAL_MS, useActiveWindowRefresh } from './useActiveWindowRefresh';

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
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exposes the 30s default interval', () => {
    expect(DEFAULT_ACTIVE_WINDOW_REFRESH_INTERVAL_MS).toBe(30_000);
  });

  it('refreshes on window focus', async () => {
    const callback = vi.fn(async () => {});
    renderHook(() => useActiveWindowRefresh(callback, { intervalMs: 0 }));
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await Promise.resolve(); });
    expect(callback).toHaveBeenCalledOnce();
  });

  it('refreshes on reconnect and on becoming visible', async () => {
    const callback = vi.fn(async () => {});
    renderHook(() => useActiveWindowRefresh(callback, { intervalMs: 0 }));
    window.dispatchEvent(new Event('online'));
    await act(async () => { await Promise.resolve(); });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('skips refreshes while hidden or offline', async () => {
    const callback = vi.fn(async () => {});
    renderHook(() => useActiveWindowRefresh(callback, { intervalMs: 0 }));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await Promise.resolve(); });
    expect(callback).not.toHaveBeenCalled();
  });

  it('polls on the interval and dedupes in-flight refreshes', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const callback = vi.fn(() => gate);
    renderHook(() => useActiveWindowRefresh(callback, { intervalMs: 1000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(callback).toHaveBeenCalledOnce();
    release();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('stays inert when disabled and swallows callback errors', async () => {
    const callback = vi.fn(async () => { throw new Error('refresh failed'); });
    const { unmount } = renderHook(() => useActiveWindowRefresh(callback, { enabled: false, intervalMs: 1000 }));
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(callback).not.toHaveBeenCalled();
    unmount();
  });

  it('cleans up listeners and intervals on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useActiveWindowRefresh(vi.fn(), { intervalMs: 1000 }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('does not miss focus when refresh becomes enabled in the same commit', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<FocusWhenEnabledProbe onRefresh={onRefresh} enabled={false} />);
    await act(async () => {
      rerender(<FocusWhenEnabledProbe onRefresh={onRefresh} enabled />);
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
