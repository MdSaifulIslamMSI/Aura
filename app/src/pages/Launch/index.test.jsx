import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/config/frontendTargets', () => ({
  resolveFrontendTargets: () => ([
    {
      id: 'vercel',
      platform: 'Vercel',
      label: 'Vercel Storefront',
      badge: 'Primary',
      originLabel: 'aurapilot.vercel.app',
      href: 'https://aurapilot.vercel.app',
      description: 'Open the Vercel-hosted Aura storefront running on the shared production backend.',
      active: false,
    },
    {
      id: 'netlify',
      platform: 'Netlify',
      label: 'Netlify Storefront',
      badge: 'Mirror',
      originLabel: 'aurapilot.netlify.app',
      href: 'https://aurapilot.netlify.app',
      description: 'Open the Netlify-hosted Aura storefront mirroring the same production commerce state.',
      active: false,
    },
  ]),
}));

vi.mock('@/config/releaseInfo', () => ({
  releaseInfo: {
    id: 'release-test-1',
    commitSha: 'abcdef123456',
    shortCommitSha: 'abcdef1',
    deployTarget: 'vercel',
    channel: 'production',
    source: 'github-actions',
    builtAt: '2026-11-12T10:00:00Z',
  },
  formatReleaseBuiltAt: () => 'Nov 12, 2026',
  resolveRuntimeHost: () => 'local',
}));

import Launch from './index';

describe('Launch gateway and showcase page', () => {
  it('renders production storefront edges, release telemetry, and interactive capability tabs', () => {
    render(
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <Launch />
        </IntlProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/one commerce platform across four production edges/i)).toBeInTheDocument();
    expect(screen.getByText('aurapilot.vercel.app')).toBeInTheDocument();
    expect(screen.getByText('aurapilot.netlify.app')).toBeInTheDocument();
    expect(screen.getByText('dip82eloip5zb.cloudfront.net')).toBeInTheDocument();
    expect(screen.getByText('aura-storefront.onrender.com')).toBeInTheDocument();

    const vercelLink = screen.getByRole('link', { name: /open vercel storefront/i });
    const netlifyLink = screen.getByRole('link', { name: /open netlify storefront/i });
    expect(vercelLink).toHaveAttribute('href', 'https://aurapilot.vercel.app');
    expect(netlifyLink).toHaveAttribute('href', 'https://aurapilot.netlify.app');

    const intelligenceTab = screen.getByRole('tab', { name: /visual search & ai compare/i });
    fireEvent.click(intelligenceTab);
    expect(screen.getByRole('link', { name: /open visual search/i })).toHaveAttribute('href', '/visual-search');
  });
});
