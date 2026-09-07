import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/clientObservability', () => ({ reportClientError: vi.fn() }));

import { reportClientError } from '@/services/clientObservability';
import SectionErrorBoundary from './SectionErrorBoundary';

const Bomb = ({ shouldThrow = false }) => {
  if (shouldThrow) throw new Error('section boom');
  return <span>section fine</span>;
};

describe('SectionErrorBoundary', () => {
  it('renders children when healthy', () => {
    render(<SectionErrorBoundary label="Reviews"><Bomb /></SectionErrorBoundary>);
    expect(screen.getByText('section fine')).toBeInTheDocument();
  });

  it('isolates the crash with the section label and reports it', () => {
    render(<SectionErrorBoundary label="Reviews"><Bomb shouldThrow /></SectionErrorBoundary>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Reviews/);
    expect(alert).toHaveTextContent(/failed to load/);
    expect(reportClientError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: 'react.section_error_boundary',
      section: 'Reviews',
    }));
  });

  it('defaults the label when none is given', () => {
    render(<SectionErrorBoundary><Bomb shouldThrow /></SectionErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent(/This section/);
  });

  it('retries and restores a healed section', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <span>section recovered</span>;
    };
    render(<SectionErrorBoundary label="Reviews"><Flaky /></SectionErrorBoundary>);
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry section' }));
    expect(screen.getByText('section recovered')).toBeInTheDocument();
  });

  it('supports custom retry labels', () => {
    render(<SectionErrorBoundary label="Reviews" retryLabel="Try again"><Bomb shouldThrow /></SectionErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
