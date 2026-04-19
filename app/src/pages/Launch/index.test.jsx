import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveFrontendTargets: vi.fn(() => [
    {
      id: 'vercel',
      label: 'Vercel frontend',
      platform: 'Vercel',
      description: 'Open the Vercel-hosted Aura storefront running on the shared production backend.',
      href: 'https://aurapilot.vercel.app',
      hostname: 'aurapilot.vercel.app',
      originLabel: 'aurapilot.vercel.app',
      isCurrent: true,
      isLive: true,
    },
    {
      id: 'netlify',
      label: 'Netlify frontend',
      platform: 'Netlify',
      description: 'Open the Netlify-hosted Aura storefront mirroring the same production commerce state.',
      href: 'https://aurapilot.netlify.app',
      hostname: 'aurapilot.netlify.app',
      originLabel: 'aurapilot.netlify.app',
      isCurrent: false,
      isLive: true,
    },
  ]),
}));

vi.mock('@/config/frontendTargets', () => ({
  resolveFrontendTargets: mocks.resolveFrontendTargets,
}));

import Launch from './index';

describe('Launch gateway page', () => {
  it('renders the upgraded gateway framing and live storefront links', () => {
    render(<Launch />);

    expect(screen.getByText(/a sharper front door for aura's live frontend stack/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for a dedicated gateway project/i)).toBeInTheDocument();
    expect(screen.getByText('aurapilot.vercel.app')).toBeInTheDocument();
    expect(screen.getByText('aurapilot.netlify.app')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /open storefront/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://aurapilot.vercel.app');
    expect(links[1]).toHaveAttribute('href', 'https://aurapilot.netlify.app');
  });
});
