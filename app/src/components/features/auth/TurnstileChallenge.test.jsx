import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/turnstileClient', () => ({
  getTurnstileSiteKey: vi.fn(() => 'test-site-key'),
  renderTurnstile: vi.fn(async () => 'widget-1'),
  removeTurnstile: vi.fn(),
}));

import { getTurnstileSiteKey, removeTurnstile, renderTurnstile } from '@/services/turnstileClient';
import TurnstileChallenge from './TurnstileChallenge';

describe('TurnstileChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTurnstileSiteKey.mockReturnValue('test-site-key');
    renderTurnstile.mockResolvedValue('widget-1');
  });

  it('renders nothing without a site key', () => {
    getTurnstileSiteKey.mockReturnValue('');
    const { container } = render(<TurnstileChallenge onToken={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(renderTurnstile).not.toHaveBeenCalled();
  });

  it('renders nothing when disabled', () => {
    getTurnstileSiteKey.mockReturnValue('key');
    const { container } = render(<TurnstileChallenge disabled onToken={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the widget container and clears stale tokens', async () => {
    const onToken = vi.fn();
    const { getByTestId } = render(<TurnstileChallenge action="login" onToken={onToken} />);
    expect(getByTestId('turnstile-challenge')).toBeInTheDocument();
    expect(onToken).toHaveBeenCalledWith('');
    expect(renderTurnstile).toHaveBeenCalledWith(expect.any(HTMLDivElement), expect.objectContaining({
      siteKey: 'test-site-key',
      action: 'login',
    }));
  });

  it('forwards fresh tokens and expiry resets', async () => {
    const onToken = vi.fn();
    render(<TurnstileChallenge onToken={onToken} />);
    const options = renderTurnstile.mock.calls[0][1];
    options.onToken('tok-abc');
    expect(onToken).toHaveBeenCalledWith('tok-abc');
    options.onExpire();
    expect(onToken).toHaveBeenLastCalledWith('');
  });

  it('reports widget errors to both callbacks', async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    render(<TurnstileChallenge onToken={onToken} onError={onError} />);
    renderTurnstile.mock.calls[0][1].onError();
    expect(onToken).toHaveBeenLastCalledWith('');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('recovers from render failures via onError', async () => {
    renderTurnstile.mockRejectedValueOnce(new Error('blocked'));
    const onToken = vi.fn();
    const onError = vi.fn();
    render(<TurnstileChallenge onToken={onToken} onError={onError} />);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onToken).toHaveBeenLastCalledWith('');
  });

  it('removes the widget on unmount', () => {
    const { unmount } = render(<TurnstileChallenge onToken={vi.fn()} />);
    unmount();
    expect(removeTurnstile).toHaveBeenCalled();
  });
});
