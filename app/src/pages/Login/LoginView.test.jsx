import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';

const t = (_id, _values, defaultMessage) => defaultMessage;

const buildProps = (overrides = {}) => ({
  OTP_TRANSPORT: { FIREBASE_SMS: 'firebase_sms' },
  accelerationCards: [],
  authError: null,
  authSuccess: null,
  canUseDesktopBrowserSignIn: true,
  canUseDesktopOwnerAccessSignIn: false,
  canUseFirebasePhoneOtp: true,
  countdown: 0,
  desktopBrowserSignInPending: false,
  firebasePhoneFallback: null,
  formData: { email: '', phone: '', password: '' },
  handleCancelDesktopBrowserSignIn: vi.fn(),
  handleDesktopBrowserSignIn: vi.fn(),
  handleReopenDesktopBrowserSignIn: vi.fn(),
  info: { title: 'Welcome back', desc: 'Secure sign-in' },
  isLoading: false,
  mode: 'signin',
  secureSignals: [],
  socialAuthStatus: { supported: true },
  step: 'form',
  t,
  trustNotes: [],
  ...overrides,
});

const renderView = (props) => render(
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter>
      <LoginView {...props} />
    </MemoryRouter>
  </IntlProvider>
);

describe('LoginView desktop browser-only mode', () => {
  it('does not render local email, phone, or password controls in Electron', () => {
    const props = buildProps();
    renderView(props);

    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue in browser/i }));
    expect(props.handleDesktopBrowserSignIn).toHaveBeenCalledOnce();
  });

  it('turns the primary action into browser recovery while a handoff is pending', () => {
    const props = buildProps({ desktopBrowserSignInPending: true });
    renderView(props);

    fireEvent.click(screen.getByRole('button', { name: /continue in browser/i }));
    expect(props.handleReopenDesktopBrowserSignIn).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /cancel browser sign-in/i }));
    expect(props.handleCancelDesktopBrowserSignIn).toHaveBeenCalledOnce();
  });
});
