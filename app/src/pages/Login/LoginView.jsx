import { Link } from 'react-router-dom';
import { useIntl } from 'react-intl';
import {
  Apple as AppleIcon,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Lock,
  Mail,
  Phone,
  Shield,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import TurnstileChallenge from '@/components/features/auth/TurnstileChallenge';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import DesktopBrowserAuthShell from '@/components/features/auth/DesktopBrowserAuthShell';
import { criticalMessages } from '@/i18n/messages/criticalMessages';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neo-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';
const fieldClass = cn(
  'w-full rounded-xl border border-white/10 bg-zinc-950/70 py-3.5 pl-11 pr-4 text-base text-white shadow-inner transition-colors placeholder:text-slate-600',
  'hover:border-white/20 focus:border-neo-cyan focus:outline-none focus:ring-2 focus:ring-neo-cyan/35'
);
const secondaryButtonClass = cn(
  'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100 transition-colors',
  'hover:border-white/25 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50',
  focusRing
);

const LoginView = ({
  OTP_TRANSPORT,
  authError,
  authSuccess,
  canUseDesktopBrowserSignIn,
  canUseDesktopOwnerAccessSignIn,
  canUseFirebasePhoneOtp,
  countdown,
  desktopBrowserSignInPending,
  firebasePhoneFallback,
  formData,
  goBack,
  handleChange,
  handleFeedbackAction,
  handlePhoneChange,
  handlePhoneCountryChange,
  handleOtpChange,
  handleOtpKeyDown,
  handleOtpPaste,
  handleResendOtp,
  handleDuoSignIn,
  isDuoLoginEnabled,
  handleDesktopBrowserSignIn,
  handleReopenDesktopBrowserSignIn,
  handleCancelDesktopBrowserSignIn,
  handleDesktopOwnerAccessSignIn,
  handleSocialSignIn,
  handleSubmit,
  handleTurnstileError,
  handleTurnstileToken,
  info,
  isEmailOtpStage,
  isLoading,
  isPhoneOtpStage,
  isSessionCheckpointPending = false,
  mode,
  otpRefs,
  otpTransport,
  otpValues = [],
  phoneCountryCode,
  phoneCountryOptions = [],
  phoneLocalValue,
  recaptchaContainerRef,
  selectedPhoneCountry,
  sessionStatus,
  setShowPassword,
  showPassword,
  signInWithFacebook,
  signInWithGitHub,
  signInWithGoogle,
  signInWithMicrosoft,
  signInWithApple,
  signInWithX,
  socialAuthStatus = {},
  step,
  submitLabel,
  switchMode,
  t,
  turnstileAction,
  turnstileEnabled,
  turnstileRefreshKey,
  emergencyActionDisabled = false,
  emergencyAuthDisabled = false,
  emergencyOtpDisabled = false,
  emergencyPasswordResetDisabled = false,
  emergencySignupDisabled = false,
}) => {
  const intl = useIntl();
  const signInActionLabel = intl.formatMessage(criticalMessages.signInAction);
  const signUpActionLabel = intl.formatMessage(criticalMessages.signUpAction);
  const hidePasswordLabel = intl.formatMessage(criticalMessages.passwordVisible);
  const showPasswordLabel = intl.formatMessage(criticalMessages.passwordHidden);
  const processingLabel = t('login.processing', {}, 'Processing');
  const unavailableLabel = t('login.actionTemporarilyUnavailable', {}, 'Temporarily unavailable');
  const primaryActionLabel = emergencyActionDisabled
    ? unavailableLabel
    : isLoading
      ? processingLabel
      : submitLabel;
  const checkpointIsMfa = sessionStatus === 'mfa_challenge_required';

  if (canUseDesktopBrowserSignIn) {
    return (
      <DesktopBrowserAuthShell
        authError={authError}
        authSuccess={authSuccess}
        canUseDesktopOwnerAccessSignIn={canUseDesktopOwnerAccessSignIn}
        desktopBrowserSignInPending={desktopBrowserSignInPending}
        emergencyAuthDisabled={emergencyAuthDisabled}
        handleCancelDesktopBrowserSignIn={handleCancelDesktopBrowserSignIn}
        handleDesktopBrowserSignIn={handleDesktopBrowserSignIn}
        handleDesktopOwnerAccessSignIn={handleDesktopOwnerAccessSignIn}
        handleFeedbackAction={handleFeedbackAction}
        handleReopenDesktopBrowserSignIn={handleReopenDesktopBrowserSignIn}
        isLoading={isLoading}
        isSessionCheckpointPending={isSessionCheckpointPending}
        sessionStatus={sessionStatus}
        t={t}
      />
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.12),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:48px_48px]" />

      <section
        aria-labelledby="login-title"
        className="relative mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-900/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8"
      >
        <header className="mb-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Link
              to="/"
              className={cn('inline-flex items-center gap-2 rounded-lg text-sm font-black uppercase tracking-[0.18em] text-white transition-colors hover:text-neo-cyan', focusRing)}
            >
              <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-neo-cyan to-neo-fuchsia text-sm text-zinc-950">
                {t('login.brand.initials', {}, 'AR')}
              </span>
              Aura
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-xs font-semibold text-emerald-100">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              {t('login.secureSignIn', {}, 'Secure sign-in')}
            </span>
          </div>

          <h1 id="login-title" className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            {info.title}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400 sm:text-base">
            {info.desc}
          </p>
        </header>

        {authError && (
          <div className="mb-5" aria-live="assertive">
            <AuthFeedback
              type="error"
              title={authError.title}
              detail={authError.detail}
              hint={authError.hint}
              actionLabel={authError.actionLabel}
              onAction={authError.action ? handleFeedbackAction : undefined}
            />
          </div>
        )}

        {authSuccess && (
          <div className="mb-5" aria-live="polite">
            <AuthFeedback
              type="success"
              title={authSuccess.title}
              detail={authSuccess.detail}
            />
          </div>
        )}

        {isSessionCheckpointPending ? (
          <section
            className="rounded-2xl border border-neo-cyan/25 bg-neo-cyan/[0.07] p-6 text-center"
            data-session-status={sessionStatus}
            role="status"
            aria-live="polite"
          >
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-neo-cyan/25 bg-zinc-950/50 text-neo-cyan">
              <Shield className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-xl font-bold text-white">
              {checkpointIsMfa
                ? t('login.checkpoint.mfaTitle', {}, 'Complete multi-factor verification')
                : t('login.checkpoint.deviceTitle', {}, 'Verify this device')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {t(
                'login.checkpoint.body',
                {},
                'Finish the security checkpoint shown on this page. You will continue automatically only after the session is fully verified.'
              )}
            </p>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              {t('login.checkpoint.stayHere', {}, 'Keep this page open. Do not submit your sign-in details again.')}
            </p>
          </section>
        ) : canUseDesktopBrowserSignIn ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-neo-cyan/20 bg-neo-cyan/[0.06] p-5 text-center">
              <ExternalLink className="mx-auto h-8 w-8 text-neo-cyan" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-bold text-white">
                {t('login.desktopBrowser.startedTitle', {}, 'Continue in Your Browser')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {t('login.desktopBrowser.startedDetail', {}, 'In the browser, enter your password and complete the email and phone codes. Aura Desktop will wait for up to 10 minutes.')}
              </p>
            </div>

            <button
              type="button"
              onClick={desktopBrowserSignInPending ? handleReopenDesktopBrowserSignIn : handleDesktopBrowserSignIn}
              disabled={emergencyAuthDisabled}
              className={cn('btn-primary flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
            >
              {desktopBrowserSignInPending ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink className="h-5 w-5" aria-hidden="true" />
              )}
              {t('login.desktopBrowser.button', {}, 'Continue in Browser')}
            </button>

            {desktopBrowserSignInPending && (
              <button
                type="button"
                onClick={handleCancelDesktopBrowserSignIn}
                className={cn(secondaryButtonClass, 'w-full border-rose-300/20 bg-rose-300/[0.06] text-rose-100 hover:bg-rose-300/10')}
              >
                {t('login.desktopBrowser.cancel', {}, 'Cancel browser sign-in')}
              </button>
            )}

            {canUseDesktopOwnerAccessSignIn && (
              <button
                type="button"
                onClick={handleDesktopOwnerAccessSignIn}
                disabled={isLoading || emergencyAuthDisabled}
                className={cn(secondaryButtonClass, 'w-full')}
              >
                <Shield className="h-4 w-4 text-emerald-200" aria-hidden="true" />
                {t('login.desktopOwnerAccess.button', {}, 'Owner Access')}
              </button>
            )}
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on" aria-busy={isLoading}>
              <div ref={recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

              {step === 'form' && (
                <>
                  {mode === 'signup' && (
                    <div>
                      <label htmlFor="login-name" className="mb-2 block text-sm font-semibold text-slate-200">
                        {t('login.field.fullName', {}, 'Full name')}
                      </label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                        <input
                          id="login-name"
                          type="text"
                          name="name"
                          value={formData.name || ''}
                          onChange={handleChange}
                          placeholder={t('login.placeholder.fullName', {}, 'Your full name')}
                          autoComplete="name"
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="login-email" className="mb-2 block text-sm font-semibold text-slate-200">
                      {mode === 'forgot-password'
                        ? t('login.field.registeredEmail', {}, 'Registered email')
                        : t('login.field.email', {}, 'Email address')}
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                      <input
                        id="login-email"
                        type="email"
                        name="email"
                        value={formData.email || ''}
                        onChange={handleChange}
                        placeholder={t('login.placeholder.email', {}, 'you@example.com')}
                        autoComplete={mode === 'signin' ? 'username' : 'email'}
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold text-slate-200">
                      {t('login.field.phone', {}, 'Phone number')}
                    </legend>
                    <div className="relative grid grid-cols-[minmax(7.5rem,8.5rem),minmax(0,1fr)] overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70 shadow-inner transition-colors focus-within:border-neo-cyan focus-within:ring-2 focus-within:ring-neo-cyan/35">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                      <label htmlFor="login-phone-country" className="sr-only">
                        {t('login.field.phoneCountry', {}, 'Country calling code')}
                      </label>
                      <select
                        id="login-phone-country"
                        name="phoneCountry"
                        value={phoneCountryCode}
                        onChange={handlePhoneCountryChange}
                        autoComplete="tel-country-code"
                        aria-label={t('login.field.phoneCountry', {}, 'Country calling code')}
                        className={cn('min-h-12 appearance-none border-0 border-r border-white/10 bg-transparent py-3.5 pl-10 pr-7 text-sm font-bold text-white outline-none', focusRing)}
                      >
                        {phoneCountryOptions.map((option) => (
                          <option key={option.countryCode} value={option.countryCode} title={option.label} className="bg-zinc-950 text-white">
                            {option.flag || option.countryCode} {option.dialCode || option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute left-[6.7rem] top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                      <input
                        type="tel"
                        name="phone"
                        value={phoneLocalValue || ''}
                        onChange={handlePhoneChange}
                        placeholder={t('login.placeholder.phoneLocal', {}, 'Phone number')}
                        autoComplete="tel-national"
                        inputMode="tel"
                        aria-label={t(
                          'login.phone.inputLabel',
                          { dialCode: selectedPhoneCountry?.dialCode || '' },
                          'Phone number {dialCode}'
                        ).trim()}
                        className="min-w-0 border-0 bg-transparent px-4 py-3.5 text-base text-white outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neo-cyan"
                      />
                    </div>
                    <p className={cn('mt-2 text-xs leading-5', firebasePhoneFallback?.disableFirebasePhoneOtp ? 'text-amber-200' : 'text-slate-500')}>
                      {firebasePhoneFallback?.disableFirebasePhoneOtp
                        ? t('login.phoneHint.fallback', {}, 'SMS delivery is unavailable here, so the available secure backup verification channel will be used.')
                        : canUseFirebasePhoneOtp
                          ? t('login.phoneHint.compact', {}, 'We will verify this sign-in with email and phone codes.')
                          : t('login.phoneHint.default', {}, 'We will send a verification code to your email and phone.')}
                    </p>
                  </fieldset>

                  {mode !== 'forgot-password' && (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-4">
                        <label htmlFor="login-password" className="text-sm font-semibold text-slate-200">
                          {t('login.field.password', {}, 'Password')}
                        </label>
                        {mode === 'signin' && (
                          <button
                            type="button"
                            onClick={() => switchMode('forgot-password')}
                            disabled={emergencyPasswordResetDisabled}
                            className={cn('rounded-md text-xs font-semibold text-neo-cyan transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                          >
                            {t('login.action.forgotPassword', {}, 'Forgot password?')}
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                        <input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          name="password"
                          value={formData.password || ''}
                          onChange={handleChange}
                          placeholder={t('login.password.placeholder', {}, 'Enter your password')}
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          className={cn(fieldClass, 'pr-12')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? hidePasswordLabel : showPasswordLabel}
                          className={cn('absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-white', focusRing)}
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {mode === 'signup' && (
                    <div>
                      <label htmlFor="login-confirm-password" className="mb-2 block text-sm font-semibold text-slate-200">
                        {t('login.field.confirmPassword', {}, 'Confirm password')}
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                        <input
                          id="login-confirm-password"
                          type={showPassword ? 'text' : 'password'}
                          name="confirmPassword"
                          value={formData.confirmPassword || ''}
                          onChange={handleChange}
                          placeholder={t('login.signup.placeholder.confirmPassword', {}, 'Re-enter your password')}
                          autoComplete="new-password"
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 'otp' && (
                <div>
                  <button type="button" onClick={goBack} className={cn('mb-5 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-slate-400 transition-colors hover:text-white', focusRing)}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('login.action.backToSignInDetails', {}, 'Back to sign-in details')}
                  </button>

                  <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <h2 className="font-bold text-white">{t('login.otp.title', {}, 'Enter verification code')}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      {isEmailOtpStage
                        ? t('login.otp.compactEmail', { email: formData.email }, 'Enter the 6-digit code sent to {{email}}. Phone verification follows.')
                        : isPhoneOtpStage || otpTransport === OTP_TRANSPORT.FIREBASE_SMS
                          ? t('login.otp.compactPhone', { phone: formData.phone }, 'Enter the 6-digit code sent to {{phone}}.')
                          : t('login.otp.compactDefault', {}, 'Enter the 6-digit verification code we sent you.')}
                    </p>
                  </div>

                  <fieldset>
                    <legend className="sr-only">{t('login.otp.codeLabel', {}, 'Six-digit verification code')}</legend>
                    <div className="mb-5 flex justify-center gap-2 sm:gap-3">
                      {otpValues.map((digit, index) => (
                        <input
                          key={index}
                          ref={(element) => { otpRefs.current[index] = element; }}
                          type="text"
                          inputMode="numeric"
                          autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          maxLength={1}
                          value={digit}
                          onChange={(event) => handleOtpChange(index, event.target.value)}
                          onKeyDown={(event) => handleOtpKeyDown(index, event)}
                          onPaste={index === 0 ? handleOtpPaste : undefined}
                          disabled={emergencyOtpDisabled}
                          aria-label={t('login.otp.digitLabel', { position: index + 1 }, 'Verification code digit {{position}}')}
                          className={cn(
                            'h-12 w-10 rounded-xl border-2 bg-zinc-950/70 text-center text-xl font-black text-white outline-none transition-colors sm:h-14 sm:w-12',
                            digit ? 'border-neo-cyan' : 'border-white/10',
                            'focus-visible:border-neo-cyan focus-visible:ring-2 focus-visible:ring-neo-cyan/50 disabled:cursor-not-allowed disabled:opacity-50'
                          )}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <div className="mb-1 text-center">
                    {countdown > 0 ? (
                      <p className="text-xs font-semibold text-slate-500">
                        {t('login.otp.resendIn', { seconds: countdown }, 'Resend in {{seconds}}s')}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={isLoading || emergencyOtpDisabled}
                        className={cn('rounded-md text-sm font-semibold text-neo-cyan transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                      >
                        {t('login.otp.resend', {}, 'Resend code')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step === 'reset-password' && (
                <div className="space-y-5">
                  <button type="button" onClick={goBack} className={cn('inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-slate-400 transition-colors hover:text-white', focusRing)}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('login.action.backToRecoveryDetails', {}, 'Back to recovery details')}
                  </button>
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-400">
                    {t('login.reset.compactBody', {}, 'Recovery is verified. Set a strong new password for this account.')}
                  </p>

                  <div>
                    <label htmlFor="login-new-password" className="mb-2 block text-sm font-semibold text-slate-200">
                      {t('login.field.newPassword', {}, 'New password')}
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                      <input
                        id="login-new-password"
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        value={formData.password || ''}
                        onChange={handleChange}
                        placeholder={t('login.reset.placeholder.newPassword', {}, 'Enter a new password')}
                        autoComplete="new-password"
                        className={cn(fieldClass, 'pr-12')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? hidePasswordLabel : showPasswordLabel}
                        className={cn('absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-white', focusRing)}
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="login-new-password-confirm" className="mb-2 block text-sm font-semibold text-slate-200">
                      {t('login.field.confirmPassword', {}, 'Confirm password')}
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                      <input
                        id="login-new-password-confirm"
                        type={showPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        value={formData.confirmPassword || ''}
                        onChange={handleChange}
                        placeholder={t('login.reset.placeholder.confirmNewPassword', {}, 'Re-enter the new password')}
                        autoComplete="new-password"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                </div>
              )}

              {turnstileEnabled && (
                <TurnstileChallenge
                  action={turnstileAction}
                  disabled={emergencyActionDisabled}
                  onError={handleTurnstileError}
                  onToken={handleTurnstileToken}
                  refreshKey={`${turnstileAction}:${turnstileRefreshKey}`}
                />
              )}

              <button
                type="submit"
                disabled={isLoading || emergencyActionDisabled}
                aria-label={primaryActionLabel}
                className={cn(
                  'btn-primary flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60',
                  focusRing
                )}
              >
                {isLoading && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                {primaryActionLabel}
              </button>
            </form>

            {step === 'form' && mode !== 'forgot-password' && (
              <details className="group mt-5 rounded-2xl border border-white/10 bg-white/[0.02]">
                <summary className={cn('flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white', focusRing)}>
                  {t('login.otherOptions', {}, 'Other secure sign-in options')}
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="space-y-3 border-t border-white/10 p-4">
                  {isDuoLoginEnabled && (
                    <button
                      type="button"
                      onClick={handleDuoSignIn}
                      disabled={isLoading || emergencyAuthDisabled}
                      className={cn(secondaryButtonClass, 'w-full')}
                    >
                      <Shield className="h-4 w-4 text-neo-cyan" aria-hidden="true" />
                      {t('login.social.duo', {}, 'Continue with Duo')}
                    </button>
                  )}

                  {socialAuthStatus.supported ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <button type="button" onClick={() => handleSocialSignIn(signInWithGoogle, 'Google')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                        <span className="text-sm font-black text-sky-300" aria-hidden="true">G</span>
                        Google
                      </button>
                      <button type="button" onClick={() => handleSocialSignIn(signInWithFacebook, 'Facebook')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                        <span className="text-sm font-black text-blue-400" aria-hidden="true">f</span>
                        Facebook
                      </button>
                      <button type="button" onClick={() => handleSocialSignIn(signInWithGitHub, 'GitHub')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                        <Github className="h-4 w-4" aria-hidden="true" />
                        GitHub
                      </button>
                      <button type="button" onClick={() => handleSocialSignIn(signInWithX, 'X')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                        <span className="text-sm font-black" aria-hidden="true">X</span>
                        X
                      </button>
                      {socialAuthStatus.microsoftEnabled && (
                        <button type="button" onClick={() => handleSocialSignIn(signInWithMicrosoft, 'Microsoft')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                          <span className="grid h-4 w-4 grid-cols-2 gap-px" aria-hidden="true">
                            <span className="bg-[#f25022]" /><span className="bg-[#7fba00]" />
                            <span className="bg-[#00a4ef]" /><span className="bg-[#ffb900]" />
                          </span>
                          Microsoft
                        </button>
                      )}
                      {socialAuthStatus.appleEnabled && (
                        <button type="button" onClick={() => handleSocialSignIn(signInWithApple, 'Apple')} disabled={isLoading || emergencyAuthDisabled} className={secondaryButtonClass}>
                          <AppleIcon className="h-4 w-4" aria-hidden="true" />
                          Apple
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className={cn('rounded-xl border px-4 py-3 text-sm leading-6', socialAuthStatus.ready ? 'border-amber-300/20 bg-amber-300/[0.05] text-amber-100' : 'border-rose-300/20 bg-rose-300/[0.05] text-rose-100')} role="note">
                      {socialAuthStatus.ready
                        ? t('login.social.useStandard', {}, 'Social sign-in is unavailable here. Use email, phone, and password instead.')
                        : t('login.social.unavailableBody', {}, 'Social sign-in could not initialize. Email, phone, and password sign-in remain available.')}
                    </div>
                  )}
                </div>
              </details>
            )}

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs leading-5 text-slate-400" role="note">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-neo-cyan" aria-hidden="true" />
              <span>{t('login.securityWarning', {}, 'Keep passwords and verification codes private. Aura support will never ask you to share a code.')}</span>
            </div>
          </>
        )}

        {!isSessionCheckpointPending && !canUseDesktopBrowserSignIn && step === 'form' && (
          <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-slate-400">
            {mode === 'forgot-password' ? (
              <>
                {t('login.modeToggle.rememberPassword', {}, 'Remember your password?')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  disabled={emergencyAuthDisabled}
                  className={cn('rounded-md font-semibold text-neo-cyan transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                >
                  {signInActionLabel}
                </button>
              </>
            ) : (
              <>
                {mode === 'signin'
                  ? t('login.modeToggle.noAccount', {}, "Don't have an account?")
                  : t('login.modeToggle.haveAccount', {}, 'Already have an account?')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                  disabled={(mode === 'signin' && emergencySignupDisabled) || (mode === 'signup' && emergencyAuthDisabled)}
                  className={cn('rounded-md font-semibold text-neo-cyan transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                >
                  {mode === 'signin' ? signUpActionLabel : signInActionLabel}
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          {t('login.terms.prefix', {}, 'By continuing, you accept our')}{' '}
          <Link to="/terms" className={cn('rounded text-slate-300 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white', focusRing)}>
            {t('login.terms.use', {}, 'Terms of Use')}
          </Link>{' '}
          {t('login.terms.middle', {}, 'and')}{' '}
          <Link to="/privacy" className={cn('rounded text-slate-300 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white', focusRing)}>
            {t('login.terms.privacy', {}, 'Privacy Policy')}
          </Link>.
        </p>
      </section>
    </div>
  );
};

export default LoginView;
