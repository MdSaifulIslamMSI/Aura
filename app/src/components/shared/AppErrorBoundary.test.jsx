import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/clientObservability', () => ({ reportClientError: vi.fn() }));

import { reportClientError } from '@/services/clientObservability';
import AppErrorBoundary from './AppErrorBoundary';

const Bomb = ({ shouldThrow = false }) => {
  if (shouldThrow) throw new Error('boom');
  return <span>all good</span>;
};

describe('AppErrorBoundary', () => {
  it('renders children when healthy', () => {
    render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('renders the fallback UI and reports on crash', () => {
    const onError = vi.fn();
    render(<AppErrorBoundary onError={onError}><Bomb shouldThrow /></AppErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(reportClientError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: 'react.error_boundary',
    }));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('renders a custom fallback when provided', () => {
    render(<AppErrorBoundary fallback={<p>custom down</p>}><Bomb shouldThrow /></AppErrorBoundary>);
    expect(screen.getByText('custom down')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('recovers via retry when the child heals', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <span>recovered</span>;
    };
    render(<AppErrorBoundary><Flaky /></AppErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry Render' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('offers a page-refresh escape hatch', () => {
    render(<AppErrorBoundary><Bomb shouldThrow /></AppErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeInTheDocument();
  });
});
