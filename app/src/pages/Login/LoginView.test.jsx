import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';

const t = (_id, values = {}, defaultMessage = '') => Object.entries(values).reduce(
  (message, [key, value]) => message
    .replaceAll(`{{${key}}}`, String(value))
    .replaceAll(`{${key}}`, String(value)),
  defaultMessage
);

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
  formData: { name: '', email: '', phone: '', password: '', confirmPassword: '' },
  goBack: vi.fn(),
  handleChange: vi.fn(),
  handleCancelDesktopBrowserSignIn: vi.fn(),
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
  submitLabel: 'SEND EMAIL + PHONE OTP',
  switchMode: vi.fn(),
  t,
  trustNotes: [],
  turnstileAction: 'auth_otp_send_signin',
  turnstileEnabled: false,
  turnstileRefreshKey: 0,
  ...overrides,
});

const renderView = (props) => render(
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter>
      <LoginView {...props} />
    </MemoryRouter>
  </IntlProvider>
);

afterEach(() => {
  vi.restoreAllMocks();
});

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

    fireEvent.click(screen.getByRole('button', { name: /open browser again/i }));
    expect(props.handleReopenDesktopBrowserSignIn).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /cancel browser sign-in/i }));
    expect(props.handleCancelDesktopBrowserSignIn).toHaveBeenCalledOnce();
  });
});

describe('LoginView ordinary-user sign-in', () => {
  it('presents a branded editorial entry without replacing the real sign-in controls', () => {
    const view = renderView(buildProps({ canUseDesktopBrowserSignIn: false }));

    expect(view.container.querySelector('aside[aria-label="Aura member benefits"]')).toBeInTheDocument();
    expect(screen.getByText('Everything you chose. Still here.')).toBeInTheDocument();
    expect(screen.getByText('Your edit')).toBeInTheDocument();
    expect(screen.getByText('Order archive')).toBeInTheDocument();
    expect(screen.getByText('Private by design')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secure access progress' })).toHaveTextContent('01Details02Verify03Access');
    expect(screen.getByText('Details').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('keeps the primary flow compact, labelled, and keyboard-focusable', () => {
    const props = buildProps({
      accelerationCards: [{ title: 'Resume faster' }],
      canUseDesktopBrowserSignIn: false,
      isDuoLoginEnabled: true,
      secureSignals: [{ label: 'Identity gate', value: 'Metrics' }],
      trustNotes: ['Rate limits and audit logs guard repeated attempts.'],
    });
    renderView(props);

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number \+91/i)).toBeInTheDocument();
    const countryPicker = screen.getByRole('button', { name: /change country code: india \+91/i });
    expect(countryPicker).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'SEND EMAIL + PHONE OTP' });
    expect(submit).toHaveClass('focus-visible:ring-2');
    expect(screen.getByLabelText('Email address')).toHaveClass('focus:ring-2');

    expect(screen.queryByText('Resume faster')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity gate')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rate limits and audit logs/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Aura support will never ask you to share a code/i)).toBeInTheDocument();

    fireEvent.click(countryPicker);
    expect(screen.getByRole('dialog', { name: 'Choose country code' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search countries or dial codes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /india\s*in \+91/i }));
    expect(props.handlePhoneCountryChange).toHaveBeenCalledWith({ target: { value: 'IN' } });

    fireEvent.click(screen.getByText('Other secure sign-in options'));
    expect(screen.getByRole('button', { name: 'Continue with Duo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument();
  });

  it('makes country search easy to reach', () => {
    const props = buildProps({
      canUseDesktopBrowserSignIn: false,
      phoneCountryOptions: [
        { countryCode: 'IN', dialCode: '+91', flag: 'IN', name: 'India', label: 'India +91' },
        { countryCode: 'US', dialCode: '+1', flag: 'US', name: 'United States', label: 'United States +1' },
      ],
    });
    renderView(props);

    fireEvent.click(screen.getByRole('button', { name: /change country code: india \+91/i }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search countries or dial codes' }), {
      target: { value: 'united' },
    });
    expect(screen.queryByRole('option', { name: /india/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /united states\s*us \+1/i }));
    expect(props.handlePhoneCountryChange).toHaveBeenCalledWith({ target: { value: 'US' } });
  });

  it('exposes the password toggle state and preserves the loading button size', () => {
    const props = buildProps({
      canUseDesktopBrowserSignIn: false,
      isLoading: true,
    });
    renderView(props);

    const passwordToggle = screen.getByRole('button', { name: /show password/i });
    expect(passwordToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(passwordToggle);
    expect(props.setShowPassword).toHaveBeenCalledWith(true);

    const submit = screen.getByRole('button', { name: 'Processing' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveClass('login-primary-button');
    expect(submit.closest('form')).toHaveAttribute('aria-busy', 'true');
  });

  it('announces offline status and prevents network-backed sign-in actions', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderView(buildProps({
      canUseDesktopBrowserSignIn: false,
      isDuoLoginEnabled: true,
    }));

    expect(screen.getByRole('status')).toHaveTextContent(/your details stay here/i);
    expect(screen.getByRole('button', { name: 'Reconnect to continue' })).toBeDisabled();

    fireEvent.click(screen.getByText('Other secure sign-in options'));
    expect(screen.getByRole('button', { name: 'Continue with Duo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Google' })).toBeDisabled();
  });

  it('labels error and success states for stable visual feedback', () => {
    const errorView = renderView(buildProps({
      canUseDesktopBrowserSignIn: false,
      authError: {
        title: 'Too many sign-in attempts',
        detail: 'Please wait a few minutes before trying again.',
      },
    }));

    expect(errorView.container.querySelector('[data-auth-state="error"]')).toBeInTheDocument();
    expect(screen.getByText('Too many sign-in attempts')).toBeInTheDocument();
    errorView.unmount();

    const successView = renderView(buildProps({
      canUseDesktopBrowserSignIn: false,
      authSuccess: {
        title: 'Welcome back',
        detail: 'Your secure sign-in is complete.',
      },
    }));

    expect(successView.container.querySelector('[data-auth-state="success"]')).toBeInTheDocument();
    expect(screen.getByText('Your secure sign-in is complete.')).toBeInTheDocument();
  });

  it('holds the route on a focused device checkpoint instead of showing the form again', () => {
    renderView(buildProps({
      canUseDesktopBrowserSignIn: false,
      isSessionCheckpointPending: true,
      sessionStatus: 'device_challenge_required',
    }));

    expect(screen.getByRole('status')).toHaveTextContent('Verify this device');
    expect(screen.getByRole('status')).toHaveTextContent('continue automatically only after the session is fully verified');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
