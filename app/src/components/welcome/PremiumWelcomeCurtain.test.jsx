import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PremiumWelcomeCurtain, {
  WELCOME_CURTAIN_SEEN_KEY,
  WELCOME_CURTAIN_SOUND_MUTED_KEY,
} from './PremiumWelcomeCurtain';
import { playWelcomeCurtainChime } from './welcomeSound';

vi.mock('./welcomeSound', () => ({
  playWelcomeCurtainChime: vi.fn(() => Promise.resolve(true)),
}));

const mockMatchMedia = (reducedMotion = false) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderCurtain = () => render(<PremiumWelcomeCurtain />);

const finishExitAnimation = () => {
  act(() => {
    vi.advanceTimersByTime(300);
  });
};

describe('PremiumWelcomeCurtain', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_WELCOME_CURTAIN_ENABLED', 'true');
    vi.stubEnv('VITE_WELCOME_CURTAIN_SOUND_ENABLED', 'true');
    window.sessionStorage.clear();
    window.localStorage.clear();
    playWelcomeCurtainChime.mockReset();
    playWelcomeCurtainChime.mockResolvedValue(true);
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('renders when enabled', () => {
    renderCurtain();

    expect(screen.getByTestId('premium-welcome-curtain')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Welcome to Aura' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(playWelcomeCurtainChime).not.toHaveBeenCalled();
  });

  it('does not render when disabled by feature flag', () => {
    vi.stubEnv('VITE_WELCOME_CURTAIN_ENABLED', 'false');

    renderCurtain();

    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
  });

  it('closes after skip click and marks the session as seen', () => {
    vi.useFakeTimers();
    renderCurtain();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(window.sessionStorage.getItem(WELCOME_CURTAIN_SEEN_KEY)).toBe('true');

    finishExitAnimation();
    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    vi.useFakeTimers();
    renderCurtain();

    fireEvent.keyDown(window, { key: 'Escape' });
    finishExitAnimation();

    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(WELCOME_CURTAIN_SEEN_KEY)).toBe('true');
  });

  it('does not show again in the same browser session', () => {
    window.sessionStorage.setItem(WELCOME_CURTAIN_SEEN_KEY, 'true');

    renderCurtain();

    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
  });

  it('auto-closes after the welcome sequence', () => {
    vi.useFakeTimers();
    renderCurtain();

    act(() => {
      vi.advanceTimersByTime(3600);
    });

    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(WELCOME_CURTAIN_SEEN_KEY)).toBe('true');
  });

  it('uses the reduced-motion path without crashing', () => {
    mockMatchMedia(true);
    renderCurtain();

    const curtain = screen.getByTestId('premium-welcome-curtain');
    expect(curtain).toHaveClass('is-reduced-motion');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('premium-welcome-curtain')).not.toBeInTheDocument();
  });

  it('does not crash when audio playback fails after a gesture', async () => {
    playWelcomeCurtainChime.mockRejectedValueOnce(new Error('audio blocked'));
    renderCurtain();

    fireEvent.pointerDown(screen.getByTestId('premium-welcome-curtain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(playWelcomeCurtainChime).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('premium-welcome-curtain')).toBeInTheDocument();
  });

  it('respects the mute preference', () => {
    window.localStorage.setItem(WELCOME_CURTAIN_SOUND_MUTED_KEY, 'true');
    renderCurtain();

    fireEvent.pointerDown(screen.getByTestId('premium-welcome-curtain'));
    expect(playWelcomeCurtainChime).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sound off' }));
    expect(window.localStorage.getItem(WELCOME_CURTAIN_SOUND_MUTED_KEY)).toBe('false');
  });
});
