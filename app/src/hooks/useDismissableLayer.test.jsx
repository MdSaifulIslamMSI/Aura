import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDismissableLayer } from './useDismissableLayer';

describe('useDismissableLayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dismisses on outside pointerdown', () => {
    const onDismiss = vi.fn();
    const inside = document.createElement('div');
    document.body.appendChild(inside);
    const ref = { current: inside };
    renderHook(() => useDismissableLayer({ refs: [ref], onDismiss }));

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
    inside.remove();
  });

  it('ignores pointerdown inside the referenced layer', () => {
    const onDismiss = vi.fn();
    const inside = document.createElement('button');
    document.body.appendChild(inside);
    renderHook(() => useDismissableLayer({ refs: [{ current: document.body }], onDismiss }));

    inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    inside.remove();
  });

  it('ignores targets matching ignore selectors', () => {
    const onDismiss = vi.fn();
    const target = document.createElement('div');
    target.className = 'keep-open';
    document.body.appendChild(target);
    renderHook(() => useDismissableLayer({ refs: [], onDismiss, ignoreSelectors: ['.keep-open'] }));

    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    target.remove();
  });

  it('dismisses on Escape and prefers onEscape when provided', () => {
    const onDismiss = vi.fn();
    const onEscape = vi.fn();
    renderHook(() => useDismissableLayer({ onDismiss }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();

    renderHook(() => useDismissableLayer({ onDismiss, onEscape }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('ignores non-Escape keys', () => {
    const onDismiss = vi.fn();
    renderHook(() => useDismissableLayer({ onDismiss }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('stays inert when disabled and cleans up listeners', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useDismissableLayer({ enabled: false, onDismiss: vi.fn() }));
    expect(addSpy).not.toHaveBeenCalledWith('pointerdown', expect.any(Function));

    const { unmount: unmountActive } = renderHook(() => useDismissableLayer({ onDismiss: vi.fn() }));
    expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    unmountActive();
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    unmount();
  });
});
