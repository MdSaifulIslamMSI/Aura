import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntlProvider } from 'react-intl';
import UptimeBars from './UptimeBars';

const renderBars = (props = {}) => render(
  <IntlProvider locale="en" defaultLocale="en">
    <UptimeBars {...props} />
  </IntlProvider>
);

describe('UptimeBars', () => {
  it('renders an accessible list with one bar per day', () => {
    renderBars({ history: [{ status: 'operational', date: '2026-09-01', uptimePercent: 99.99 }] });
    expect(screen.getByRole('list', { name: 'Uptime history' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('caps the window at 90 days', () => {
    const history = Array.from({ length: 120 }, (_, i) => ({ status: 'operational', uptimePercent: 100, date: `d-${i}` }));
    renderBars({ history });
    expect(screen.getAllByRole('listitem')).toHaveLength(90);
  });

  it('labels days without data accessibly', () => {
    renderBars({ history: [{ status: 'unknown' }] });
    expect(screen.getByRole('listitem').getAttribute('aria-label')).toContain('No monitoring data');
  });

  it('formats uptime percentages to two decimals with downtime', () => {
    renderBars({ history: [{ status: 'degraded', date: '2026-09-02', uptimePercent: 99.5, downtimeMinutes: 7 }] });
    expect(screen.getByRole('listitem').getAttribute('aria-label')).toContain('99.50% uptime');
  });

  it('renders compact bars in compact mode', () => {
    const { container } = renderBars({ history: [{ status: 'operational', uptimePercent: 100 }], compact: true });
    expect(container.querySelector('.h-5.w-1')).not.toBeNull();
  });

  it('accepts custom labels and empty histories', () => {
    const { container } = renderBars({ history: [], label: 'API uptime' });
    expect(screen.getByRole('list', { name: 'API uptime' })).toBeInTheDocument();
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});
