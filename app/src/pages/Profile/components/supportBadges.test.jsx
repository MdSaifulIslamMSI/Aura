import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getStatusBadge } from './supportBadges';

const t = (_key, _opts, fallback) => fallback;

describe('getStatusBadge', () => {
  it('renders the resolved badge with emerald styling', () => {
    const { container } = render(getStatusBadge('resolved', t));
    expect(container.textContent).toContain('Resolved');
    expect(container.innerHTML).toContain('emerald');
  });

  it('renders the closed badge', () => {
    const { container } = render(getStatusBadge('closed', t));
    expect(container.textContent).toContain('Closed');
  });

  it('defaults unknown statuses to the open badge', () => {
    for (const status of ['open', 'pending', undefined, 'escalated']) {
      const { container, unmount } = render(getStatusBadge(status, t));
      expect(container.textContent).toContain('Open');
      unmount();
    }
  });

  it('always renders an icon alongside the label', () => {
    const { container } = render(getStatusBadge('resolved', t));
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
