import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DesktopBrowserAuthShell from './DesktopBrowserAuthShell';

const t = (_id, values = {}, defaultMessage = '') => Object.entries(values).reduce(
  (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
  defaultMessage
);

const buildProps = (overrides = {}) => ({
  authError: null,
  authSuccess: null,
  canUseDesktopOwnerAccessSignIn: false,
  desktopBrowserSignInPending: false,
  emergencyAuthDisabled: false,
  handleCancelDesktopBrowserSignIn: vi.fn(),
  handleDesktopBrowserSignIn: vi.fn(),
  handleDesktopOwnerAccessSignIn: vi.fn(),
  handleReopenDesktopBrowserSignIn: vi.fn(),
  info: { title: 'Welcome back' },
  isLoading: false,
  isSessionCheckpointPending: false,
  sessionStatus: 'signed_out',
  signUpActionLabel: 'Sign up',
  t,
  ...overrides,
});

const renderShell = (props) => render(
  <MemoryRouter>
    <DesktopBrowserAuthShell {...props} />
  </MemoryRouter>
);

describe('DesktopBrowserAuthShell', () => {
  it('starts a browser-only sign-in without rendering credential inputs', () => {
    const props = buildProps();
    renderShell(props);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(/Aura support will never ask/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue in browser/i }));
    expect(props.handleDesktopBrowserSignIn).toHaveBeenCalledOnce();
  });

  it('shows explicit cancel and recovery actions while waiting for the browser', () => {
    const props = buildProps({ desktopBrowserSignInPending: true });
    renderShell(props);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button', { name: /cancel browser sign-in/i }));
    fireEvent.click(screen.getByRole('button', { name: /open browser again/i }));
    expect(props.handleCancelDesktopBrowserSignIn).toHaveBeenCalledOnce();
    expect(props.handleReopenDesktopBrowserSignIn).toHaveBeenCalledOnce();
  });

  it('holds the route on the active MFA checkpoint', () => {
    renderShell(buildProps({
      isSessionCheckpointPending: true,
      sessionStatus: 'mfa_challenge_required',
    }));

    expect(screen.getByRole('status')).toHaveTextContent('Complete multi-factor verification');
    expect(screen.queryByRole('button', { name: /continue in browser/i })).not.toBeInTheDocument();
  });
});
