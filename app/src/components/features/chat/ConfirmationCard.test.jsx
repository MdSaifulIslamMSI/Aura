import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => (_id, _values, fallback = '') => fallback,
}));

import ConfirmationCard from './ConfirmationCard';

const confirmation = { action: 'place_order', token: 'tok-1', message: 'Place order for Rs.999?' };

describe('ConfirmationCard', () => {
  it('renders nothing without an action', () => {
    const { container } = render(<ConfirmationCard confirmation={{}} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the confirmation message with actions', () => {
    render(<ConfirmationCard confirmation={confirmation} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Place order for Rs.999?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument();
  });

  it('confirms with the token and cancels cleanly', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmationCard confirmation={confirmation} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('tok-1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('supports modify callbacks and white mode styling', () => {
    const onModify = vi.fn();
    const { container } = render(
      <ConfirmationCard confirmation={confirmation} onConfirm={vi.fn()} onCancel={vi.fn()} onModify={onModify} isWhiteMode />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    expect(onModify).toHaveBeenCalledOnce();
    expect(container.innerHTML).toContain('bg-white');
  });

  it('tolerates missing callbacks', () => {
    render(<ConfirmationCard confirmation={confirmation} />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))).not.toThrow();
  });
});
