import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthFeedback } from './AuthFeedback';

describe('AuthFeedback', () => {
  it('renders error title, detail and hint', () => {
    const { container } = render(<AuthFeedback type="error" title="Login failed" detail="Wrong password" hint="Try again" />);
    const text = container.textContent;
    expect(text).toContain('Login failed');
    expect(text).toContain('Wrong password');
    expect(text).toContain('Try again');
  });

  it('renders success styling for success type', () => {
    const { container } = render(<AuthFeedback type="success" title="Verified" detail="Done" />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(container.firstChild.className).not.toContain('rose');
  });

  it('picks contextual icons per failure kind', () => {
    const { rerender } = render(<AuthFeedback title="Session expired, login again" detail="x" />);
    expect(rerender).toBeDefined();
    for (const title of ['Account locked after attempts', 'User not found', 'Network connection lost', 'Session mismatch']) {
      const { container, unmount } = render(<AuthFeedback title={title} detail="x" />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('stringifies object-shaped errors safely', () => {
    render(<AuthFeedback title={{ message: 'Object title' }} detail={{ message: 'Object detail' }} />);
    expect(screen.getByText('Object title')).toBeInTheDocument();
    expect(screen.getByText('Object detail')).toBeInTheDocument();
  });

  it('fires the action callback from the action button', () => {
    const onAction = vi.fn();
    render(<AuthFeedback title="Locked" detail="x" actionLabel="Retry" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action button when no label is given', () => {
    render(<AuthFeedback title="Locked" detail="x" onAction={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('applies compact styling for modals', () => {
    const { container } = render(<AuthFeedback title="T" detail="D" compact />);
    expect(container.firstChild).not.toBeNull();
  });
});
