import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopLogin from './index';

const translate = (_id, values = {}, defaultMessage = '') => Object.entries(values).reduce(
  (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
  defaultMessage
);

let controller;

vi.mock('@/pages/Login/useLoginController', () => ({
  useLoginController: () => controller,
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: translate }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => translate,
}));

vi.mock('@/context/EmergencyStatusContext', () => ({
  useEmergencyStatus: () => ({ isFeatureDisabled: () => false }),
}));

vi.mock('@/components/features/auth/TurnstileChallenge', () => ({
  default: ({ action }) => <div data-testid="turnstile-challenge">{action}</div>,
}));

const buildController = (overrides = {}) => ({
  OTP_TRANSPORT: { FIREBASE_SMS: 'firebase_sms' },
  authError: null,
  authSuccess: null,
  canUseFirebasePhoneOtp: true,
  countdown: 0,
  desktopBrowserConsentIdentity: null,
  desktopBrowserConsentActionLabel: 'Continue',
  desktopBrowserConsentReady: false,
  desktopBrowserConsentStage: 'idle',
  desktopBrowserConsentSubmitting: false,
  desktopBrowserConsentSubmittingLabel: 'Opening Aura Desktop',
  desktopBrowserHandoff: { active: true },
  desktopBrowserSessionHydrating: false,
  desktopBrowserSignInPending: false,
  firebasePhoneFallback: null,
  formData: { name: '', email: '', phone: '', password: '', confirmPassword: '' },
  goBack: vi.fn(),
  handleChange: vi.fn(),
  handleDesktopBrowserConsent: vi.fn(),
  handleDesktopBrowserConsentCancel: vi.fn(),
  handleDuoSignIn: vi.fn(),
  handleFeedbackAction: vi.fn(),
  handleOtpChange: vi.fn(),
  handleOtpKeyDown: vi.fn(),
  handleOtpPaste: vi.fn(),
  handlePhoneChange: vi.fn(),
  handlePhoneCountryChange: vi.fn(),
  handleResendOtp: vi.fn(),
  handleSocialSignIn: vi.fn(),
  handleSubmit: vi.fn((event) => event.preventDefault()),
  handleTurnstileError: vi.fn(),
  handleTurnstileToken: vi.fn(),
  info: {
    title: 'WELCOME BACK',
    desc: 'Sign in with your password, then verify your email and phone.',
  },
  isDuoLoginEnabled: true,
  isEmailOtpStage: false,
  isLoading: false,
  isPhoneOtpStage: false,
  mode: 'signin',
  otpRefs: { current: [] },
  otpTransport: 'backend_otp',
  otpValues: ['', '', '', '', '', ''],
  phoneCountryCode: 'IN',
  phoneCountryOptions: [{ countryCode: 'IN', dialCode: '+91', flag: 'IN', label: 'India +91' }],
  phoneLocalValue: '',
  recaptchaContainerRef: { current: null },
  setShowPassword: vi.fn(),
  showPassword: false,
  signInWithApple: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithX: vi.fn(),
  socialAuthStatus: { supported: true, appleEnabled: true, microsoftEnabled: true },
  step: 'form',
  submitLabel: 'SEND EMAIL + PHONE OTP',
  switchMode: vi.fn(),
  turnstileAction: 'auth_otp_send_signin',
  turnstileEnabled: true,
  turnstileRefreshKey: 0,
  ...overrides,
});

const DesktopLoginHarness = () => (
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter>
      <DesktopLogin />
    </MemoryRouter>
  </IntlProvider>
);

const renderDesktopLogin = () => render(<DesktopLoginHarness />);

describe('DesktopLogin tactile hosted browser flow', () => {
  beforeEach(() => {
    controller = buildController();
  });

  it('keeps the complete secure sign-in surface in the compact Aura shell', () => {
    const view = renderDesktopLogin();

    expect(view.container.querySelector('img[src="/assets/icon-512.png"]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Country calling code')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByTestId('turnstile-challenge')).toHaveTextContent('auth_otp_send_signin');
    expect(screen.getByText(/request expires after 10 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/Aura support will never ask you to share a code/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(controller.handleSubmit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Duo' }));
    expect(controller.handleDuoSignIn).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(controller.handleSocialSignIn).toHaveBeenCalledWith(controller.signInWithGoogle, 'Google');
  });

  it('preserves OTP navigation, entry, resend, and submission actions', () => {
    controller = buildController({
      countdown: 0,
      info: { title: 'VERIFY EMAIL', desc: 'Enter the code sent to your email.' },
      isEmailOtpStage: true,
      step: 'otp',
      submitLabel: 'VERIFY EMAIL CODE',
      turnstileEnabled: false,
    });
    renderDesktopLogin();

    const digits = screen.getAllByLabelText(/Verification code digit/i);
    expect(digits).toHaveLength(6);
    fireEvent.change(digits[0], { target: { value: '4' } });
    expect(controller.handleOtpChange).toHaveBeenCalledWith(0, '4');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(controller.goBack).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(controller.handleResendOtp).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(controller.handleSubmit).toHaveBeenCalledOnce();
  });

  it('renders consent actions and locks them while the sealed handoff submits', () => {
    controller = buildController({
      desktopBrowserConsentIdentity: { email: 'owner@example.com' },
      desktopBrowserConsentReady: true,
    });
    const view = renderDesktopLogin();

    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(controller.handleDesktopBrowserConsentCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(controller.handleDesktopBrowserConsent).toHaveBeenCalledOnce();

    controller = {
      ...controller,
      desktopBrowserConsentReady: false,
      desktopBrowserConsentSubmitting: true,
    };
    view.rerender(<DesktopLoginHarness />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Opening Aura Desktop' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Securely returning sign-in to Aura Desktop.');
  });

  it('shows the passkey step honestly before opening Aura Desktop', () => {
    controller = buildController({
      desktopBrowserConsentActionLabel: 'Verify passkey & continue',
      desktopBrowserConsentIdentity: 'admin@example.com',
      desktopBrowserConsentReady: true,
    });
    const view = renderDesktopLogin();

    expect(screen.getByRole('button', { name: 'Verify passkey & continue' })).toBeEnabled();

    controller = {
      ...controller,
      desktopBrowserConsentReady: false,
      desktopBrowserConsentStage: 'passkey',
      desktopBrowserConsentSubmitting: true,
      desktopBrowserConsentSubmittingLabel: 'Checking passkey',
    };
    view.rerender(<DesktopLoginHarness />);

    expect(screen.getByRole('button', { name: 'Checking passkey' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for passkey verification');
    expect(screen.queryByText('Finishing Desktop Sign-In')).not.toBeInTheDocument();
  });

  it('holds the credential form behind a neutral session hydration state', () => {
    controller = buildController({ desktopBrowserSessionHydrating: true });
    renderDesktopLogin();

    expect(screen.getByRole('heading', { name: 'Checking your Aura session' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/confirming whether this trusted browser is already signed in/i);
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Google' })).not.toBeInTheDocument();
  });
});
