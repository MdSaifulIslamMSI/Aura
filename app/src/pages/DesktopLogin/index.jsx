import { Link } from 'react-router-dom';
import {
  Apple,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import AuraTrustedDeviceChallenge from '@/components/features/auth/AuraTrustedDeviceChallenge';
import MfaChallengePanel from '@/components/features/auth/MfaChallengePanel';
import TurnstileChallenge from '@/components/features/auth/TurnstileChallenge';
import { useEmergencyStatus } from '@/context/EmergencyStatusContext';
import { cn } from '@/lib/utils';
import { useLoginController } from '@/pages/Login/useLoginController';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#212121]';
const motionSafeControl = 'transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.99] motion-reduce:transition-none motion-reduce:transform-none';
const fieldClass = cn(
  'min-h-[4.0625rem] w-full rounded-full border border-[#444] bg-transparent py-4 pl-12 pr-5 text-base font-semibold text-slate-50 outline-none',
  'placeholder:text-[#8f8f8f] hover:border-[#626262] focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-55',
  motionSafeControl
);
const primaryButtonClass = cn(
  'inline-flex min-h-[4.0625rem] w-full items-center justify-center gap-3 rounded-full bg-[#f9f9f9] px-6 py-4 text-base font-bold text-[#181818]',
  'hover:bg-white disabled:cursor-not-allowed disabled:bg-[#8c8c8c] disabled:text-[#252525] disabled:opacity-100',
  focusRing,
  motionSafeControl
);
const secondaryButtonClass = cn(
  'inline-flex min-h-[4.0625rem] w-full items-center justify-center gap-3 rounded-full border border-[#444] bg-transparent px-6 py-4 text-base font-semibold text-slate-50',
  'hover:border-[#666] hover:bg-white/[0.045] disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
  motionSafeControl
);
const providerButtonClass = cn(secondaryButtonClass, 'justify-center text-[0.9375rem]');

const AuraBrand = ({ centered = false, large = false }) => (
  <div className={cn('flex items-center gap-3', centered && 'justify-center')}>
    <img
      src="/assets/icon-512.png"
      alt=""
      aria-hidden="true"
      className={cn(
        'shrink-0 rounded-[0.9rem] object-cover shadow-[0_12px_32px_rgba(6,182,212,0.16)]',
        large ? 'h-14 w-14' : 'h-9 w-9'
      )}
    />
    {!large ? <span className="text-xl font-black tracking-[-0.04em] text-white">AURA</span> : null}
  </div>
);

const FieldLabel = ({ htmlFor, children, action = null }) => (
  <div className="mb-2 flex items-end justify-between gap-3 px-1">
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-200">
      {children}
    </label>
    {action}
  </div>
);

const InputShell = ({ icon: Icon, children }) => (
  <div className="group/input relative min-w-0">
    <Icon
      className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#8f8f8f] transition-colors group-focus-within/input:text-cyan-300 motion-reduce:transition-none"
      aria-hidden="true"
    />
    {children}
  </div>
);

const SecurityNotice = ({ t }) => (
  <div className="flex items-start gap-3 rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] px-4 py-3 text-left text-xs leading-5 text-amber-50" role="note">
    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
    <span>
      {t(
        'desktopLogin.handoff.stepsDetail',
        {},
        'Enter your password, verify the email code, then verify the phone code. Keep Aura Desktop open; the request expires after 10 minutes.'
      )}
    </span>
  </div>
);

const PrivateCodeNotice = ({ t }) => (
  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-xs leading-5 text-[#a8a8a8]" role="note">
    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
    <span>
      {t(
        'login.securityWarning',
        {},
        'Keep passwords and verification codes private. Aura support will never ask you to share a code.'
      )}
    </span>
  </div>
);

const LegalCopy = ({ t }) => (
  <p className="text-center text-xs leading-5 text-[#8f8f8f]">
    {t('login.terms.prefix', {}, 'By continuing, you accept our')}{' '}
    <Link
      to="/terms"
      className={cn('rounded text-slate-300 underline decoration-white/30 underline-offset-2 hover:text-white', focusRing)}
    >
      {t('login.terms.use', {}, 'Terms of Use')}
    </Link>{' '}
    {t('login.terms.middle', {}, 'and')}{' '}
    <Link
      to="/privacy"
      className={cn('rounded text-slate-300 underline decoration-white/30 underline-offset-2 hover:text-white', focusRing)}
    >
      {t('login.terms.privacy', {}, 'Privacy Policy')}
    </Link>.
  </p>
);

const getConsentIdentityLabel = (identity, fallback) => {
  if (typeof identity === 'string' && identity.trim()) return identity.trim();
  if (!identity || typeof identity !== 'object') return fallback;

  return String(
    identity.email
    || identity.maskedEmail
    || identity.label
    || identity.displayName
    || identity.name
    || identity.user?.email
    || fallback
  ).trim();
};

const ConsentView = ({ controller, t }) => {
  const submitting = Boolean(controller.desktopBrowserConsentSubmitting);
  const continueHandlerAvailable = typeof controller.handleDesktopBrowserConsent === 'function';
  const cancelHandlerAvailable = typeof controller.handleDesktopBrowserConsentCancel === 'function';
  const identityLabel = getConsentIdentityLabel(
    controller.desktopBrowserConsentIdentity,
    t('desktopLogin.consent.accountFallback', {}, 'Signed-in Aura account')
  );

  return (
    <section
      className="mx-auto w-full max-w-[32rem] text-center"
      aria-labelledby="desktop-consent-title"
      aria-describedby="desktop-consent-description"
      aria-busy={submitting}
    >
      <h1 id="desktop-consent-title" className="sr-only">
        {t('desktopLogin.consent.title', {}, 'Continue to Aura Desktop')}
      </h1>

      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#444] bg-[#1b1b1b] px-4 py-2.5 text-sm font-semibold text-white">
        <User className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{identityLabel}</span>
      </div>

      {controller.authError ? (
        <div className="mt-5 text-left" aria-live="assertive">
          <AuthFeedback
            type="error"
            title={controller.authError.title}
            detail={controller.authError.detail}
            hint={controller.authError.hint}
            actionLabel={controller.authError.actionLabel}
            onAction={controller.authError.action ? controller.handleFeedbackAction : undefined}
          />
        </div>
      ) : null}

      {controller.authSuccess ? (
        <div className="mt-5 text-left" aria-live="polite">
          <AuthFeedback type="success" title={controller.authSuccess.title} detail={controller.authSuccess.detail} />
        </div>
      ) : null}

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={controller.handleDesktopBrowserConsentCancel}
          disabled={submitting || !cancelHandlerAvailable}
          className={secondaryButtonClass}
        >
          {t('common.action.cancel', {}, 'Cancel')}
        </button>
        <button
          type="button"
          onClick={controller.handleDesktopBrowserConsent}
          disabled={submitting || !continueHandlerAvailable}
          className={primaryButtonClass}
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          <span>
            {submitting
              ? (controller.desktopBrowserConsentSubmittingLabel
                || t('desktopLogin.consent.submitting', {}, 'Opening Aura Desktop'))
              : (controller.desktopBrowserConsentActionLabel
                || t('common.action.continue', {}, 'Continue'))}
          </span>
        </button>
      </div>

      <p id="desktop-consent-description" className="mx-auto mt-14 max-w-[34rem] text-sm leading-5 text-slate-300">
        {t(
          'desktopLogin.consent.security',
          {},
          'Only continue if you started this sign-in from Aura Desktop. Aura sends a one-time sealed session to this device; your required identity and security checks remain in force.'
        )}
      </p>
      <div className="mt-4">
        <LegalCopy t={t} />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {submitting
          ? (controller.desktopBrowserConsentStage === 'passkey'
            ? t('desktopLogin.consent.passkeyStatus', {}, 'Waiting for passkey verification before returning sign-in to Aura Desktop.')
            : t('desktopLogin.consent.status', {}, 'Securely returning sign-in to Aura Desktop.'))
          : ''}
      </p>
    </section>
  );
};

const InactiveRequestView = ({ t }) => (
  <section className="mx-auto w-full max-w-[26.5625rem] text-center" aria-labelledby="desktop-request-inactive-title">
    <AuraBrand centered large />
    <h1 id="desktop-request-inactive-title" className="mt-7 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
      {t('desktopLogin.inactive.title', {}, 'Desktop request not active')}
    </h1>
    <p className="mt-4 text-base leading-7 text-[#a8a8a8]">
      {t(
        'desktopLogin.inactive.detail',
        {},
        'Start again from Aura Desktop so this browser can bind sign-in to the trusted local request.'
      )}
    </p>
    <div className="mt-8">
      <PrivateCodeNotice t={t} />
    </div>
    <div className="mt-6">
      <LegalCopy t={t} />
    </div>
  </section>
);

const SessionHydrationView = ({ t }) => (
  <section
    className="mx-auto w-full max-w-[26.5625rem] text-center"
    aria-labelledby="desktop-session-hydration-title"
    aria-describedby="desktop-session-hydration-detail"
    aria-busy="true"
  >
    <AuraBrand centered large />
    <Loader2
      className="mx-auto mt-8 h-6 w-6 animate-spin text-[#a8a8a8] motion-reduce:animate-none"
      aria-hidden="true"
    />
    <h1 id="desktop-session-hydration-title" className="mt-6 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
      {t('desktopLogin.hydration.title', {}, 'Checking your browser session')}
    </h1>
    <p id="desktop-session-hydration-detail" className="mt-4 text-base leading-7 text-[#a8a8a8]" role="status" aria-live="polite">
      {t(
        'desktopLogin.hydration.detail',
        {},
        'Confirming your browser session before Aura verifies this device for the desktop handoff.'
      )}
    </p>
  </section>
);

const DesktopLogin = () => {
  const controller = useLoginController();
  const { t: legacyT } = useMarket();
  const t = useStableIcuMessages(legacyT);
  const { isFeatureDisabled } = useEmergencyStatus();
  const loginDisabled = isFeatureDisabled('login');
  const signupDisabled = isFeatureDisabled('signup');
  const otpDisabled = isFeatureDisabled('otp');
  const passwordResetDisabled = isFeatureDisabled('password_reset');
  const emergencyActionDisabled = (
    (controller.step === 'otp' && otpDisabled)
    || (controller.step === 'reset-password' && passwordResetDisabled)
    || (controller.mode === 'signin' && loginDisabled)
    || (controller.mode === 'signup' && signupDisabled)
    || (controller.mode === 'forgot-password' && passwordResetDisabled)
  );
  const handoffActive = controller.desktopBrowserHandoff.active;
  const actionDisabled = controller.isLoading || emergencyActionDisabled || !handoffActive;
  const socialDisabled = controller.isLoading || loginDisabled || !handoffActive;
  const showProviderStack = controller.isDuoLoginEnabled || controller.socialAuthStatus.supported;
  const showConsent = handoffActive && Boolean(
    controller.desktopBrowserConsentReady
    || controller.desktopBrowserConsentSubmitting
    || controller.desktopBrowserHandoffPreflightFailed
  );
  const sessionHydrationPending = handoffActive && Boolean(controller.desktopBrowserSessionHydrating);
  const desktopBrowserHandoffCheckpoint = controller.desktopBrowserHandoffCheckpoint;
  const showDeviceCheckpoint = handoffActive && Boolean(
    desktopBrowserHandoffCheckpoint?.status === 'device_challenge_required'
    && desktopBrowserHandoffCheckpoint?.deviceChallenge
  );
  const showMfaCheckpoint = handoffActive && Boolean(
    desktopBrowserHandoffCheckpoint?.status === 'mfa_challenge_required'
    || desktopBrowserHandoffCheckpoint?.mfaBlocked === true
  );
  const pageTitle = controller.step === 'reset-password'
    ? t('desktopLogin.title.newPassword', {}, 'Choose a new password')
    : controller.step === 'otp'
      ? controller.isEmailOtpStage
        ? t('desktopLogin.title.verifyEmail', {}, 'Verify your email')
        : controller.isPhoneOtpStage
          ? t('desktopLogin.title.verifyPhone', {}, 'Verify your phone')
          : t('desktopLogin.title.verifyCode', {}, 'Enter your verification code')
      : controller.mode === 'signup'
        ? t('desktopLogin.title.signup', {}, 'Create your account')
        : controller.mode === 'forgot-password'
          ? t('desktopLogin.title.recovery', {}, 'Reset your password')
          : t('desktopLogin.title.welcome', {}, 'Welcome back');
  const primaryActionLabel = controller.step === 'reset-password'
    ? t('desktopLogin.action.resetPassword', {}, 'Reset password')
    : t('common.action.continue', {}, 'Continue');

  return (
    <div className="min-h-screen overflow-y-auto bg-[#212121] text-white antialiased">
      <header className="px-5 py-5 sm:px-7 sm:py-6">
        <div className="inline-flex">
          <AuraBrand />
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-5.5rem)] items-center justify-center px-5 pb-16 pt-8 sm:px-8 sm:pb-20 sm:pt-10">
        {sessionHydrationPending ? (
          <SessionHydrationView t={t} />
        ) : showDeviceCheckpoint ? (
          <AuraTrustedDeviceChallenge
            challengeOverride={desktopBrowserHandoffCheckpoint.deviceChallenge}
            onVerifyChallenge={controller.handleDesktopBrowserDeviceChallenge}
            onExit={controller.handleDesktopBrowserConsentCancel}
          />
        ) : showMfaCheckpoint ? (
          <MfaChallengePanel
            challenge={desktopBrowserHandoffCheckpoint.mfaChallenge}
            policy={desktopBrowserHandoffCheckpoint.mfaPolicy}
            isAdmin={desktopBrowserHandoffCheckpoint?.roles?.isAdmin === true}
            blocked={desktopBrowserHandoffCheckpoint.mfaBlocked === true}
            onVerifyPasskey={controller.handleDesktopBrowserMfaPasskey}
            onVerifyTotp={controller.handleDesktopBrowserMfaTotp}
            onVerifyRecoveryCode={controller.handleDesktopBrowserMfaRecoveryCode}
            onCancel={controller.handleDesktopBrowserConsentCancel}
          />
        ) : showConsent ? (
          <ConsentView controller={controller} t={t} />
        ) : !handoffActive ? (
          <InactiveRequestView t={t} />
        ) : (
          <section className="mx-auto w-full max-w-[26.5625rem]" aria-labelledby="desktop-login-title">
            <header className="mb-7 text-center">
              <h1 id="desktop-login-title" className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
                {pageTitle}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#a8a8a8] sm:text-base">
                {controller.info.desc}
              </p>
            </header>

            <div className="mb-5">
              <SecurityNotice t={t} />
            </div>

            {controller.authError ? (
              <div className="mb-5" aria-live="assertive">
                <AuthFeedback
                  type="error"
                  title={controller.authError.title}
                  detail={controller.authError.detail}
                  hint={controller.authError.hint}
                  actionLabel={controller.authError.actionLabel}
                  onAction={controller.authError.action ? controller.handleFeedbackAction : undefined}
                />
              </div>
            ) : null}

            {controller.authSuccess ? (
              <div className="mb-5" aria-live="polite">
                <AuthFeedback type="success" title={controller.authSuccess.title} detail={controller.authSuccess.detail} />
              </div>
            ) : null}

            <form onSubmit={controller.handleSubmit} className="space-y-5" autoComplete="on" aria-busy={controller.isLoading}>
              <div ref={controller.recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

              {controller.step === 'form' ? (
                <>
                  {controller.mode === 'signup' ? (
                    <div>
                      <FieldLabel htmlFor="desktop-login-name">
                        {t('desktopLogin.field.fullName', {}, 'Full name')}
                      </FieldLabel>
                      <InputShell icon={User}>
                        <input
                          id="desktop-login-name"
                          name="name"
                          value={controller.formData.name}
                          onChange={controller.handleChange}
                          autoComplete="name"
                          placeholder={t('desktopLogin.placeholder.fullName', {}, 'Your full name')}
                          className={fieldClass}
                        />
                      </InputShell>
                    </div>
                  ) : null}

                  <div>
                    <FieldLabel htmlFor="desktop-login-email">
                      {controller.mode === 'forgot-password'
                        ? t('desktopLogin.field.registeredEmail', {}, 'Registered email')
                        : t('desktopLogin.field.email', {}, 'Email address')}
                    </FieldLabel>
                    <InputShell icon={Mail}>
                      <input
                        id="desktop-login-email"
                        type="email"
                        name="email"
                        value={controller.formData.email}
                        onChange={controller.handleChange}
                        autoComplete={controller.mode === 'signin' ? 'username' : 'email'}
                        placeholder={t('desktopLogin.placeholder.email', {}, 'you@example.com')}
                        className={fieldClass}
                      />
                    </InputShell>
                  </div>

                  <div>
                    <FieldLabel htmlFor="desktop-login-phone">
                      {t('desktopLogin.field.phoneNumber', {}, 'Phone number')}
                    </FieldLabel>
                    <div className="relative flex min-h-[4.0625rem] overflow-hidden rounded-full border border-[#444] bg-transparent transition-colors focus-within:border-cyan-300 focus-within:ring-2 focus-within:ring-cyan-300/20 motion-reduce:transition-none">
                      <Phone className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#8f8f8f]" aria-hidden="true" />
                      <select
                        value={controller.phoneCountryCode}
                        onChange={controller.handlePhoneCountryChange}
                        aria-label={t('desktopLogin.phone.countryCallingCode', {}, 'Country calling code')}
                        className="h-[4.0625rem] w-[8.5rem] shrink-0 appearance-none border-0 border-r border-white/10 bg-transparent py-4 pl-11 pr-7 text-sm font-bold text-white outline-none"
                      >
                        {controller.phoneCountryOptions.map((option) => (
                          <option key={option.countryCode} value={option.countryCode} title={option.label} className="bg-[#212121] text-white">
                            {option.flag} {option.dialCode}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute left-[6.75rem] top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8f8f]" aria-hidden="true" />
                      <input
                        id="desktop-login-phone"
                        type="tel"
                        name="phone"
                        value={controller.phoneLocalValue}
                        onChange={controller.handlePhoneChange}
                        autoComplete="tel-national"
                        inputMode="tel"
                        placeholder={t('desktopLogin.placeholder.phone', {}, 'Phone number')}
                        className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 text-base font-semibold text-white outline-none placeholder:text-[#8f8f8f]"
                      />
                    </div>
                  </div>

                  {controller.mode !== 'forgot-password' ? (
                    <div>
                      <FieldLabel
                        htmlFor="desktop-login-password"
                        action={controller.mode === 'signin' ? (
                          <button
                            type="button"
                            onClick={() => controller.switchMode('forgot-password')}
                            disabled={passwordResetDisabled}
                            className={cn('rounded-md text-sm font-semibold text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                          >
                            {t('desktopLogin.password.forgot', {}, 'Forgot password?')}
                          </button>
                        ) : null}
                      >
                        {t('desktopLogin.field.password', {}, 'Password')}
                      </FieldLabel>
                      <InputShell icon={Lock}>
                        <input
                          id="desktop-login-password"
                          type={controller.showPassword ? 'text' : 'password'}
                          name="password"
                          value={controller.formData.password}
                          onChange={controller.handleChange}
                          autoComplete={controller.mode === 'signup' ? 'new-password' : 'current-password'}
                          placeholder={t('desktopLogin.placeholder.password', {}, 'Enter your password')}
                          className={cn(fieldClass, 'pr-14')}
                        />
                        <button
                          type="button"
                          onClick={() => controller.setShowPassword(!controller.showPassword)}
                          className={cn('absolute right-2.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#8f8f8f] hover:bg-white/[0.05] hover:text-white', focusRing)}
                          aria-label={controller.showPassword
                            ? t('desktopLogin.password.hide', {}, 'Hide password')
                            : t('desktopLogin.password.show', {}, 'Show password')}
                        >
                          {controller.showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                        </button>
                      </InputShell>
                    </div>
                  ) : null}

                  {controller.mode === 'signup' ? (
                    <div>
                      <FieldLabel htmlFor="desktop-login-confirm-password">
                        {t('desktopLogin.field.confirmPassword', {}, 'Confirm password')}
                      </FieldLabel>
                      <InputShell icon={Lock}>
                        <input
                          id="desktop-login-confirm-password"
                          type={controller.showPassword ? 'text' : 'password'}
                          name="confirmPassword"
                          value={controller.formData.confirmPassword}
                          onChange={controller.handleChange}
                          autoComplete="new-password"
                          placeholder={t('desktopLogin.placeholder.confirmPassword', {}, 'Confirm your password')}
                          className={fieldClass}
                        />
                      </InputShell>
                    </div>
                  ) : null}
                </>
              ) : null}

              {controller.step === 'otp' ? (
                <div>
                  <button
                    type="button"
                    onClick={controller.goBack}
                    className={cn('mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-slate-300 hover:text-white', focusRing)}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('common.action.back', {}, 'Back')}
                  </button>

                  <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm leading-6 text-slate-300">
                    {controller.isEmailOtpStage
                      ? t('desktopLogin.otp.emailSent', { email: controller.formData.email }, 'Code sent to {email}.')
                      : controller.isPhoneOtpStage
                        ? t('desktopLogin.otp.phoneSent', { phone: controller.formData.phone }, 'Code sent to {phone}.')
                        : t('desktopLogin.otp.enter', {}, 'Enter the secure verification code to continue.')}
                  </div>

                  <div className="mb-6 flex justify-center gap-2 sm:gap-3">
                    {controller.otpValues.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => (controller.otpRefs.current[index] = element)}
                        aria-label={t('desktopLogin.otp.digit', { number: index + 1 }, 'Verification code digit {number}')}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        maxLength={1}
                        value={digit}
                        onChange={(event) => controller.handleOtpChange(index, event.target.value)}
                        onKeyDown={(event) => controller.handleOtpKeyDown(index, event)}
                        onPaste={index === 0 ? controller.handleOtpPaste : undefined}
                        disabled={otpDisabled}
                        className={cn(
                          'h-14 w-11 rounded-2xl border bg-transparent text-center text-2xl font-bold text-white outline-none transition-colors focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-50 motion-reduce:transition-none',
                          digit ? 'border-cyan-300' : 'border-[#444] focus:border-cyan-300'
                        )}
                      />
                    ))}
                  </div>

                  <div className="mb-2 text-center">
                    {controller.countdown > 0 ? (
                      <p className="text-xs font-semibold text-[#8f8f8f]">
                        {t('desktopLogin.otp.resendIn', { count: controller.countdown }, 'Resend in {count}s')}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={controller.handleResendOtp}
                        disabled={controller.isLoading || otpDisabled}
                        className={cn('rounded-md text-xs font-bold text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                      >
                        {t('desktopLogin.otp.resend', {}, 'Resend code')}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              {controller.step === 'reset-password' ? (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={controller.goBack}
                    className={cn('inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-slate-300 hover:text-white', focusRing)}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('common.action.back', {}, 'Back')}
                  </button>
                  <div>
                    <FieldLabel htmlFor="desktop-login-new-password">
                      {t('desktopLogin.field.newPassword', {}, 'New password')}
                    </FieldLabel>
                    <InputShell icon={Lock}>
                      <input
                        id="desktop-login-new-password"
                        type={controller.showPassword ? 'text' : 'password'}
                        name="password"
                        value={controller.formData.password}
                        onChange={controller.handleChange}
                        autoComplete="new-password"
                        placeholder={t('desktopLogin.placeholder.newPassword', {}, 'New password')}
                        className={fieldClass}
                      />
                    </InputShell>
                  </div>
                  <div>
                    <FieldLabel htmlFor="desktop-login-reset-confirm-password">
                      {t('desktopLogin.field.confirmPassword', {}, 'Confirm password')}
                    </FieldLabel>
                    <InputShell icon={Lock}>
                      <input
                        id="desktop-login-reset-confirm-password"
                        type={controller.showPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        value={controller.formData.confirmPassword}
                        onChange={controller.handleChange}
                        autoComplete="new-password"
                        placeholder={t('desktopLogin.placeholder.confirmPasswordShort', {}, 'Confirm password')}
                        className={fieldClass}
                      />
                    </InputShell>
                  </div>
                </div>
              ) : null}

              {controller.turnstileEnabled ? (
                <TurnstileChallenge
                  action={controller.turnstileAction}
                  disabled={actionDisabled}
                  onError={controller.handleTurnstileError}
                  onToken={controller.handleTurnstileToken}
                  refreshKey={`${controller.turnstileAction}:${controller.turnstileRefreshKey}`}
                />
              ) : null}

              <button type="submit" disabled={actionDisabled} className={primaryButtonClass}>
                {controller.isLoading ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                {emergencyActionDisabled
                  ? t('desktopLogin.action.temporarilyUnavailable', {}, 'Temporarily unavailable')
                  : controller.desktopBrowserSignInPending
                    ? t('desktopLogin.action.waitingForBrowser', {}, 'Waiting for browser')
                    : primaryActionLabel}
              </button>
            </form>

            {controller.step === 'form' && controller.mode !== 'forgot-password' ? (
              <div className="mt-6">
                <p className="text-center text-sm text-slate-300">
                  {controller.mode === 'signup'
                    ? t('desktopLogin.mode.haveAccount', {}, 'Already have an account?')
                    : t('desktopLogin.mode.noAccount', {}, "Don't have an account?")}{' '}
                  <button
                    type="button"
                    onClick={() => controller.switchMode(controller.mode === 'signup' ? 'signin' : 'signup')}
                    disabled={controller.isLoading || (controller.mode === 'signin' ? signupDisabled : loginDisabled)}
                    className={cn('rounded-md font-semibold text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                  >
                    {controller.mode === 'signup'
                      ? t('desktopLogin.mode.signIn', {}, 'Sign in')
                      : t('desktopLogin.mode.signUp', {}, 'Sign up')}
                  </button>
                </p>

                <div className="my-6 flex items-center gap-4" aria-hidden="true">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs font-bold uppercase text-[#8f8f8f]">{t('common.choice.or', {}, 'or')}</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                {showProviderStack ? (
                  <div className="space-y-4">
                    {controller.isDuoLoginEnabled ? (
                      <button type="button" onClick={controller.handleDuoSignIn} disabled={socialDisabled} className={providerButtonClass}>
                        <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                        {t('desktopLogin.provider.duo', {}, 'Continue with Duo')}
                      </button>
                    ) : null}

                    {controller.socialAuthStatus.supported ? (
                      <>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGoogle, 'Google')} disabled={socialDisabled} className={providerButtonClass}>
                          <span className="text-lg font-black text-[#4285f4]" aria-hidden="true">G</span>
                          Google
                        </button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithFacebook, 'Facebook')} disabled={socialDisabled} className={providerButtonClass}>
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1877f2] text-sm font-black text-white" aria-hidden="true">f</span>
                          Facebook
                        </button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGitHub, 'GitHub')} disabled={socialDisabled} className={providerButtonClass}>
                          <Github className="h-5 w-5" aria-hidden="true" />
                          GitHub
                        </button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithX, 'X')} disabled={socialDisabled} className={providerButtonClass}>
                          <span className="text-lg font-black" aria-hidden="true">X</span>
                          X
                        </button>
                        {controller.socialAuthStatus.microsoftEnabled ? (
                          <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithMicrosoft, 'Microsoft')} disabled={socialDisabled} className={providerButtonClass}>
                            <span className="grid h-4 w-4 shrink-0 grid-cols-2 gap-px" aria-hidden="true">
                              <span className="bg-[#f25022]" />
                              <span className="bg-[#7fba00]" />
                              <span className="bg-[#00a4ef]" />
                              <span className="bg-[#ffb900]" />
                            </span>
                            Microsoft
                          </button>
                        ) : null}
                        {controller.socialAuthStatus.appleEnabled ? (
                          <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithApple, 'Apple')} disabled={socialDisabled} className={providerButtonClass}>
                            <Apple className="h-5 w-5" aria-hidden="true" />
                            Apple
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] px-4 py-3 text-sm leading-6 text-amber-50" role="note">
                    {t(
                      'desktopLogin.social.unavailable',
                      {},
                      'Social access is unavailable for this deployment. Use your email, phone, and password instead.'
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {controller.step === 'form' && controller.mode === 'forgot-password' ? (
              <p className="mt-6 text-center text-sm text-slate-300">
                {t('desktopLogin.mode.rememberPassword', {}, 'Remember your password?')}{' '}
                <button
                  type="button"
                  onClick={() => controller.switchMode('signin')}
                  disabled={controller.isLoading || loginDisabled}
                  className={cn('rounded-md font-semibold text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                >
                  {t('desktopLogin.mode.signIn', {}, 'Sign in')}
                </button>
              </p>
            ) : null}

            <div className="mt-6">
              <PrivateCodeNotice t={t} />
            </div>
            <div className="mt-6">
              <LegalCopy t={t} />
            </div>
            <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-200">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('desktopLogin.handoff.active', {}, 'Desktop handoff active')}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default DesktopLogin;
