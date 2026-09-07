import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ScrollToTop from './index';

const renderAt = (path = '/products') => render(
  <MemoryRouter initialEntries={[path]}>
    <ScrollToTop />
  </MemoryRouter>
);

describe('ScrollToTop', () => {
  it('renders nothing visible', () => {
    const { container } = renderAt();
    expect(container).toBeEmptyDOMElement();
  });

  it('scrolls to top on fresh navigation', () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    renderAt('/products?page=2');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('delegates to lenis smooth scroller when present', () => {
    const scrollTo = vi.fn();
    window.__AURA_LENIS__ = { scrollTo, scroll: 500 };
    renderAt('/cart');
    expect(scrollTo).toHaveBeenCalledWith(0, expect.objectContaining({ immediate: true }));
    delete window.__AURA_LENIS__;
  });

  it('persists scroll memory across unmount', () => {
    window.sessionStorage.clear();
    const { unmount } = renderAt('/wishlist');
    window.dispatchEvent(new Event('scroll'));
    unmount();
    expect(window.sessionStorage.getItem('aura_scroll_memory_v1')).not.toBeNull();
  });

  it('tolerates sessionStorage failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    const { unmount } = renderAt('/x');
    expect(() => unmount()).not.toThrow();
    vi.restoreAllMocks();
  });
});
