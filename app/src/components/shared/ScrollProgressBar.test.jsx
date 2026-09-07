import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const motion = vi.hoisted(() => ({ mode: 'full' }));

vi.mock('@/context/MotionModeContext', () => ({
  useMotionMode: () => ({ effectiveMotionMode: motion.mode }),
}));

import ScrollProgressBar from './ScrollProgressBar';

const renderBar = () => render(
  <MemoryRouter>
    <ScrollProgressBar />
  </MemoryRouter>
);

describe('ScrollProgressBar', () => {
  it('renders the progress track as decorative', () => {
    const { container } = renderBar();
    const track = container.querySelector('.aura-scroll-progress');
    expect(track).not.toBeNull();
    expect(track.getAttribute('aria-hidden')).toBe('true');
  });

  it('starts at zero progress', () => {
    const { container } = renderBar();
    const bar = container.querySelector('.aura-scroll-progress > div');
    expect(bar).not.toBeNull();
  });

  it('updates on scroll events without crashing', () => {
    renderBar();
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
  });

  it('cleans up listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderBar();
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
