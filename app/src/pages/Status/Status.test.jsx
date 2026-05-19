import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UptimeBars from './UptimeBars';
import { SystemStatusCard } from './index';

const history90d = Array.from({ length: 90 }, (_, index) => ({
  date: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
  status: index % 17 === 0 ? 'degraded' : 'operational',
  uptimePercent: index % 17 === 0 ? 99.4 : 99.99,
  downtimeMinutes: index % 17 === 0 ? 4 : 0,
}));

describe('status page components', () => {
  it('renders 90 uptime bars with accessible labels', () => {
    render(<UptimeBars history={history90d} label="API uptime" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(90);
    expect(screen.getAllByLabelText(/99.99% uptime/i).length).toBeGreaterThan(0);
  });

  it('labels unknown uptime bars as no monitoring data', () => {
    render(
      <UptimeBars
        history={[{ date: '2026-05-18', status: 'unknown', uptimePercent: null, downtimeMinutes: null }]}
        label="API uptime"
      />
    );

    expect(screen.getByLabelText('2026-05-18: No monitoring data for this day')).toBeInTheDocument();
  });

  it('expands component group details', () => {
    render(
      <SystemStatusCard
        monitoringStartedAt="2026-05-19T00:00:00.000Z"
        uptimeSinceMonitoringBegan={100}
        groups={[{
          id: 'group-api',
          name: 'API',
          status: 'operational',
          uptimePercent90d: 99.98,
          monitoringStartedAt: '2026-05-19T00:00:00.000Z',
          componentsCount: 1,
          history90d,
          components: [{
            id: 'component-public-api',
            name: 'Public API',
            status: 'operational',
            uptimePercent90d: 99.98,
            monitoringStartedAt: '2026-05-19T00:00:00.000Z',
            lastCheckedAt: '2026-05-19T10:00:00.000Z',
            lastResponseTimeMs: 128,
            history90d,
          }],
        }]}
      />
    );

    expect(screen.queryByText('Public API')).not.toBeInTheDocument();
    expect(screen.getByText(/Uptime since monitoring began: 100.00% uptime/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /API/i }));
    expect(screen.getByText('Public API')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(180);
  });
});
