import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productApi } from '@/services/api';
import { solveChromePath } from '@/utils/frontendOptimizers';
import { usePrefetchOracle } from './usePrefetchOracle';

vi.mock('@/services/api', () => ({
  productApi: { prefetchProductById: vi.fn() },
}));

vi.mock('@/utils/frontendOptimizers', () => ({
  solveChromePath: vi.fn(() => []),
}));

describe('usePrefetchOracle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers and cleans up the mousemove listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => usePrefetchOracle([]));

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
  });

  it('prefetches optimal assets once the intent window elapses', () => {
    solveChromePath.mockReturnValue([{ id: 'p1' }, { id: 'p2' }]);
    renderHook(() => usePrefetchOracle([{ id: 'p1', rating: 5 }, { id: 'p2', rating: 4 }]));

    // Advance beyond the 500ms intent window, then move the mouse.
    Date.now.mockReturnValue(1_000_600);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }));

    expect(solveChromePath).toHaveBeenCalledOnce();
    expect(productApi.prefetchProductById).toHaveBeenCalledWith('p1');
    expect(productApi.prefetchProductById).toHaveBeenCalledWith('p2');
  });

  it('skips prefetching inside the 500ms intent window', () => {
    renderHook(() => usePrefetchOracle([{ id: 'p1', rating: 5 }]));
    Date.now.mockReturnValue(1_000_100);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));

    expect(solveChromePath).not.toHaveBeenCalled();
    expect(productApi.prefetchProductById).not.toHaveBeenCalled();
  });

  it('maps _id fallback and rating probability into candidates', () => {
    solveChromePath.mockReturnValue([]);
    renderHook(() => usePrefetchOracle([{ _id: 'mongo-1', rating: 2.5 }]));
    Date.now.mockReturnValue(1_001_000);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));

    expect(solveChromePath).toHaveBeenCalledOnce();
    const [mousePos, candidates] = solveChromePath.mock.calls[0];
    expect(mousePos).toEqual({ x: 5, y: 5 });
    expect(candidates[0]).toEqual(expect.objectContaining({ id: 'mongo-1', probability: 0.5 }));
  });

  it('ignores assets without ids', () => {
    solveChromePath.mockReturnValue([{ id: null }, {}]);
    renderHook(() => usePrefetchOracle([]));
    Date.now.mockReturnValue(1_002_000);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
    expect(productApi.prefetchProductById).not.toHaveBeenCalled();
  });
});
