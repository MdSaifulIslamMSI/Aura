import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';

const t = (_id, values = {}, defaultMessage = '') => defaultMessage;

const baseProps = {
  OTP_TRANSPORT: { FIREBASE_SMS: 'firebase_sms' },
  accelerationCards: [],
  authError: null,
  authSuccess: null,
  canUseDesktopBrowserSignIn: false,
  canUseDesktopOwnerAccessSignIn: false,
  canUseFirebasePhoneOtp: true,
  countdown: 0,
  desktopBrowserSignInPending: false,
  firebasePhoneFallback: null,
  formData: { name: '', email: '', phone: '', password: '', confirmPassword: '' },
  goBack: vi.fn(),
  handleChange: vi.fn(),
  handleCancelDesktopBrowserSignIn: vi.fn(),
  handleDesktopAdminSignIn: vi.fn(),
  handleDesktopBrowserSignIn: vi.fn(),
  handleDesktopOwnerAccessSignIn: vi.fn(),
  handleDuoSignIn: vi.fn(),
  handleFeedbackAction: vi.fn(),
  handleOtpChange: vi.fn(),
  handleOtpKeyDown: vi.fn(),
  handleOtpPaste: vi.fn(),
  handlePhoneChange: vi.fn(),
  handlePhoneCountryChange: vi.fn(),
  handleResendOtp: vi.fn(),
  handleReopenDesktopBrowserSignIn: vi.fn(),
  handleSocialSignIn: vi.fn(),
  handleSubmit: vi.fn((event) => event.preventDefault()),
  handleTurnstileError: vi.fn(),
  handleTurnstileToken: vi.fn(),
  info: { title: 'Welcome back', desc: 'Secure sign-in' },
  isDuoLoginEnabled: false,
  isLoading: false,
  isSessionCheckpointPending: false,
  mode: 'signin',
  otpRefs: { current: [] },
  otpTransport: 'backend_otp',
  otpValues: ['', '', '', '', '', ''],
  phoneCountryCode: 'IN',
  phoneCountryOptions: [{ countryCode: 'IN', dialCode: '+91', flag: 'IN', name: 'India', label: 'India +91' }],
  phoneLocalValue: '',
  recaptchaContainerRef: { current: null },
  secureSignals: [],
  selectedPhoneCountry: { countryCode: 'IN', dialCode: '+91', flag: 'IN', name: 'India' },
  sessionStatus: 'signed_out',
  setShowPassword: vi.fn(),
  showPassword: false,
  signInWithApple: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithX: vi.fn(),
  socialAuthStatus: { supported: true },
  step: 'form',
  submitLabel: 'Continue',
  switchMode: vi.fn(),
  t,
  trustNotes: [],
  turnstileAction: 'auth_otp_send_signin',
  turnstileEnabled: false,
  turnstileRefreshKey: 0,
};

const renderView = (overrides = {}) => render(
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter>
      <LoginView {...baseProps} {...overrides} />
    </MemoryRouter>
  </IntlProvider>,
);

describe('LoginView 1Password compatibility', () => {
  it('keeps signin credentials fillable (username + current-password)', () => {
    const view = renderView({ mode: 'signin' });
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(view.container.querySelector('form.login-form')).toHaveAttribute('autocomplete', 'on');
  });

  it('uses new-password for signup and reset so managers offer generation', () => {
    const signup = renderView({ mode: 'signup' });
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('autocomplete', 'new-password');
    signup.unmount();

    renderView({ mode: 'signin', step: 'reset-password' });
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('exposes one-time-code on the first OTP cell only', () => {
    const view = renderView({ mode: 'signin', step: 'otp' });
    const cells = view.container.querySelectorAll('.login-otp-input');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('never sets autocomplete=off on credential inputs', () => {
    const view = renderView({ mode: 'signin' });
    for (const input of view.container.querySelectorAll('#login-email, #login-password')) {
      expect(input.getAttribute('autocomplete')).not.toBe('off');
    }
  });
});
