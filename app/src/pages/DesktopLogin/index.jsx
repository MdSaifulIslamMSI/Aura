import {
  Apple,
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  Fingerprint,
  Github,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Network,
  Phone,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  User,
  Zap,
} from 'lucide-react';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import TurnstileChallenge from '@/components/features/auth/TurnstileChallenge';
import { useEmergencyStatus } from '@/context/EmergencyStatusContext';
import { cn } from '@/lib/utils';
import { useLoginController } from '@/pages/Login/useLoginController';
import { FormattedMessage } from 'react-intl';

const providerButtonClass = 'flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-[1rem] border border-white/10 bg-[#0a1427]/90 px-4 py-3 text-sm font-bold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-cyan-300/35 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50';
const fieldClass = 'min-w-0 w-full rounded-[1rem] border border-slate-600/55 bg-[#071225]/90 py-4 pl-12 pr-4 text-base font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';

const bridgeSignals = [
  { label: 'Delivery', value: 'Hosted', icon: Cloud, accent: 'text-cyan-300' },
  { label: 'API', value: 'Protected', icon: ShieldCheck, accent: 'text-emerald-300' },
  { label: 'Callback', value: 'Loopback', icon: RefreshCw, accent: 'text-amber-300' },
];

const desktopCapabilities = [
  { label: 'Request locked', icon: ShieldCheck, accent: 'text-cyan-300' },
  { label: 'Verified proof', icon: Fingerprint, accent: 'text-cyan-300' },
  { label: 'Sealed token', icon: Lock, accent: 'text-indigo-300' },
  { label: 'Loopback only', icon: Network, accent: 'text-lime-300' },
  { label: 'Desktop only', icon: Monitor, accent: 'text-cyan-300' },
  { label: 'Trace ready', icon: Activity, accent: 'text-sky-300' },
];

const statusPills = [
  { label: 'Secure by design', icon: ShieldCheck },
  { label: 'Privacy first', icon: Lock },
  { label: 'Built for trust', icon: CheckCircle2 },
];

const AuraMark = () => (
  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.9rem] border border-cyan-300/20 bg-[#081528] shadow-[0_0_28px_rgba(34,211,238,0.13)]">
    <span className="font-sans text-3xl font-black text-cyan-300">A</span>
  </div>
);

const SignalCard = ({ icon: Icon, label, value, accent = 'text-cyan-300' }) => (
  <div className="flex min-w-0 items-center gap-3 rounded-[0.95rem] border border-white/10 bg-[#0a1427]/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
    <Icon className={cn('h-6 w-6 shrink-0', accent)} />
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="truncate text-base font-black text-white">{value}</p>
    </div>
  </div>
);

const CapabilityTile = ({ icon: Icon, label, accent }) => (
  <div className="flex min-h-20 min-w-0 items-center gap-3 rounded-[1rem] border border-white/10 bg-[#0a1427]/75 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
    <Icon className={cn('h-6 w-6 shrink-0', accent)} />
    <span className="min-w-0 text-sm font-bold text-white">{label}</span>
  </div>
);

const DesktopShieldVisual = () => (
  <div className="pointer-events-none relative hidden min-h-72 flex-1 items-center justify-center lg:flex">
    <div className="absolute h-56 w-56 rounded-full border border-cyan-300/20 bg-cyan-300/[0.03] shadow-[0_0_64px_rgba(34,211,238,0.22)]" />
    <div className="absolute h-72 w-72 animate-spin-slow rounded-full border border-cyan-300/15 border-l-cyan-300/50 border-r-transparent" />
    <div className="absolute h-44 w-72 rotate-[-18deg] rounded-full border border-cyan-300/20" />
    <div className="absolute h-44 w-72 rotate-[22deg] rounded-full border border-blue-400/20" />
    <div className="absolute bottom-8 h-12 w-56 rounded-full border border-cyan-300/25 bg-cyan-300/[0.05] blur-[1px]" />
    <div className="relative flex h-40 w-40 animate-float items-center justify-center rounded-[2rem] border border-cyan-300/35 bg-gradient-to-br from-cyan-300/25 via-blue-500/20 to-slate-950 shadow-[0_0_50px_rgba(34,211,238,0.35)]">
      <ShieldCheck className="absolute h-36 w-36 text-cyan-200/80 drop-shadow-[0_0_20px_rgba(34,211,238,0.45)]" strokeWidth={1.4} />
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/35 bg-slate-950/70 shadow-[0_0_28px_rgba(34,211,238,0.38)]">
        <Lock className="h-9 w-9 text-cyan-100" />
      </div>
    </div>
    <span className="absolute left-12 top-16 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.95)]" />
    <span className="absolute right-16 top-20 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.95)]" />
    <span className="absolute bottom-24 right-10 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.95)]" />
  </div>
);

const FieldLabel = ({ children, action = null }) => (
  <div className="mb-2 flex items-end justify-between gap-3">
    <label className="block text-xs font-black uppercase text-slate-300">{children}</label>
    {action}
  </div>
);

const DesktopInputShell = ({ icon: Icon, children }) => (
  <div className="group/input relative min-w-0">
    <Icon className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within/input:text-cyan-300" />
    {children}
  </div>
);

const DesktopLogin = () => {
  const controller = useLoginController();
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
  const showProviderGrid = controller.isDuoLoginEnabled || controller.socialAuthStatus.supported;
  const stepLabel = controller.step === 'otp'
    ? 'OTP lane'
    : controller.step === 'reset-password'
      ? 'Recovery lane'
      : controller.mode === 'signup'
        ? 'Account lane'
        : 'Credential lane';

  return (
    <div className="min-h-screen overflow-hidden bg-[#020712] text-white">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(30,64,175,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,0.1)_1px,transparent_1px)] [background-size:58px_58px] opacity-35" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,13,30,0.96),rgba(2,7,18,0.9)_45%,rgba(4,16,30,0.96))]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[96rem] flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4 py-1">
          <div className="flex min-w-0 items-center gap-4">
            <AuraMark />
            <p className="truncate text-xl font-black uppercase text-slate-100 sm:text-2xl">Aura Desktop</p>
          </div>
          <div className={cn(
            'hidden items-center gap-2 rounded-full border px-6 py-3 text-sm font-black uppercase sm:inline-flex',
            handoffActive
              ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200'
              : 'border-amber-300/35 bg-amber-300/10 text-amber-200'
          )}>
            <ShieldCheck className="h-5 w-5" />
            {handoffActive ? 'Request armed' : 'Request missing'}
          </div>
        </header>

        <main className="grid min-w-0 flex-1 items-center gap-6 py-6 lg:grid-cols-[0.96fr_1.04fr] xl:gap-8">
          <section className="relative min-w-0 overflow-hidden rounded-[1.35rem] border border-blue-400/20 bg-[#071126]/80 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-8 lg:min-h-[46rem]">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),transparent_38%),linear-gradient(215deg,rgba(59,130,246,0.08),transparent_44%)]" />
            <div className="relative z-10 flex h-full flex-col justify-between gap-8">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-5 py-2 text-sm font-black uppercase text-cyan-200">
                  <Network className="h-5 w-5" />
                  {stepLabel}
                </div>

                <div className="mt-8 grid flex-1 items-center gap-8 lg:grid-cols-[1fr_0.82fr]">
                  <div className="min-w-0">
                    <h1 className="max-w-xl text-4xl font-black leading-[1.15] tracking-normal text-white sm:text-5xl xl:text-6xl">
                      One focused login bridge for <span className="text-cyan-300">Aura Desktop.</span>
                    </h1>
                    <p className="mt-6 max-w-xl break-words text-lg font-semibold leading-8 text-slate-300">
                      Your browser completes the identity proof, then Aura Desktop receives a sealed session result through the trusted local bridge.
                    </p>
                  </div>
                  <DesktopShieldVisual />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {desktopCapabilities.map((capability) => (
                  <CapabilityTile key={capability.label} {...capability} />
                ))}
              </div>

              <div className="grid overflow-hidden rounded-[1rem] border border-white/10 bg-[#071225]/80 sm:grid-cols-3">
                {statusPills.map(({ label, icon: Icon }, index) => (
                  <div key={label} className={cn('flex items-center justify-center gap-3 px-4 py-4 text-sm font-semibold text-slate-200', index > 0 && 'border-t border-white/10 sm:border-l sm:border-t-0')}>
                    <Icon className="h-5 w-5 text-cyan-300" />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-[1.35rem] border border-cyan-300/30 bg-[#071126]/86 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6 lg:min-h-[46rem]">
            {!handoffActive ? (
              <div className="flex min-h-[32rem] flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.1rem] border border-amber-300/25 bg-amber-300/10">
                  <TimerReset className="h-8 w-8 text-amber-200" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-normal">Desktop request not active</h2>
                <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-400">
                  Start again from Aura Desktop so this browser lane can bind to the local session request.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-7 grid gap-3 sm:grid-cols-3">
                  {bridgeSignals.map((signal) => (
                    <SignalCard key={signal.label} {...signal} />
                  ))}
                </div>

                {controller.authError ? (
                  <div className="mb-4">
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
                  <div className="mb-4">
                    <AuthFeedback type="success" title={controller.authSuccess.title} detail={controller.authSuccess.detail} />
                  </div>
                ) : null}

                <form onSubmit={controller.handleSubmit} className="space-y-5" autoComplete="on">
                  <div ref={controller.recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

                  {controller.step === 'form' ? (
                    <>
                      {controller.mode === 'signup' ? (
                        <div>
                          <FieldLabel>Full Name *</FieldLabel>
                          <DesktopInputShell icon={User}>
                            <input name="name" value={controller.formData.name} onChange={controller.handleChange} autoComplete="name" placeholder="Your full name" className={fieldClass} />
                          </DesktopInputShell>
                        </div>
                      ) : null}

                      <div>
                        <FieldLabel>{controller.mode === 'forgot-password' ? 'Registered Email *' : 'Email Address *'}</FieldLabel>
                        <DesktopInputShell icon={Mail}>
                          <input type="email" name="email" value={controller.formData.email} onChange={controller.handleChange} autoComplete={controller.mode === 'signin' ? 'username' : 'email'} placeholder="name@example.com" className={fieldClass} />
                        </DesktopInputShell>
                      </div>

                      <div>
                        <FieldLabel>Phone Number *</FieldLabel>
                        <div className="relative flex min-h-14 overflow-hidden rounded-[1rem] border border-slate-600/55 bg-[#071225]/90 transition focus-within:border-cyan-300 focus-within:ring-2 focus-within:ring-cyan-300/20">
                          <Phone className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" />
                          <select value={controller.phoneCountryCode} onChange={controller.handlePhoneCountryChange} aria-label="Country calling code" className="h-full shrink-0 appearance-none border-0 border-r border-white/10 bg-transparent py-4 pl-11 pr-7 text-sm font-black text-white outline-none" style={{ width: '9rem' }}>
                            {controller.phoneCountryOptions.map((option) => (
                              <option key={option.countryCode} value={option.countryCode} title={option.label} className="bg-slate-950 text-white">
                                {option.flag} {option.dialCode}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" style={{ left: '7rem' }} />
                          <input type="tel" name="phone" value={controller.phoneLocalValue} onChange={controller.handlePhoneChange} autoComplete="tel-national" inputMode="tel" placeholder="9876543210" className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 text-base font-semibold text-white outline-none placeholder:text-slate-500" />
                        </div>
                      </div>

                      {controller.mode !== 'forgot-password' ? (
                        <div>
                          <FieldLabel
                            action={controller.mode === 'signin' ? (
                              <button type="button" onClick={() => controller.switchMode('forgot-password')} disabled={passwordResetDisabled} className="text-sm font-bold text-cyan-300 transition hover:text-white disabled:opacity-50">
                                Forgot password?
                              </button>
                            ) : null}
                          >
                            Password *
                          </FieldLabel>
                          <DesktopInputShell icon={Lock}>
                            <input type={controller.showPassword ? 'text' : 'password'} name="password" value={controller.formData.password} onChange={controller.handleChange} autoComplete={controller.mode === 'signup' ? 'new-password' : 'current-password'} placeholder="Enter your password" className={`${fieldClass} pr-14`} />
                            <button type="button" onClick={() => controller.setShowPassword(!controller.showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white" aria-label={controller.showPassword ? 'Hide password' : 'Show password'}>
                              {controller.showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </DesktopInputShell>
                        </div>
                      ) : null}

                      {controller.mode === 'signup' ? (
                        <div>
                          <FieldLabel>Confirm Password *</FieldLabel>
                          <DesktopInputShell icon={KeyRound}>
                            <input type={controller.showPassword ? 'text' : 'password'} name="confirmPassword" value={controller.formData.confirmPassword} onChange={controller.handleChange} autoComplete="new-password" placeholder="Confirm your password" className={fieldClass} />
                          </DesktopInputShell>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {controller.step === 'otp' ? (
                    <div>
                      <button type="button" onClick={controller.goBack} className="mb-5 inline-flex items-center gap-2 text-sm font-black uppercase text-slate-400 transition hover:text-white">
                        <ArrowLeft className="h-4 w-4" /> Back
                      </button>
                      <div className="mb-6 rounded-[1rem] border border-cyan-300/20 bg-cyan-300/10 p-4">
                        <p className="text-xs font-black uppercase text-cyan-100">{controller.isEmailOtpStage ? 'Email verification' : controller.isPhoneOtpStage ? 'Phone verification' : 'Verification code'}</p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{controller.isEmailOtpStage ? `Code sent to ${controller.formData.email}.` : controller.isPhoneOtpStage ? `Code sent to ${controller.formData.phone}.` : <FormattedMessage id="auth.jsx.expression.enter.the.secure.otp.to.continue" defaultMessage="Enter the secure OTP to continue." />}</p>
                      </div>
                      <div className="mb-6 flex justify-center gap-2 sm:gap-3">
                        {controller.otpValues.map((digit, index) => (
                          <input
                            key={index}
                            ref={(element) => (controller.otpRefs.current[index] = element)}
                            type="text"
                            inputMode="numeric"
                            autoComplete={index === 0 ? 'one-time-code' : 'off'}
                            maxLength={1}
                            value={digit}
                            onChange={(event) => controller.handleOtpChange(index, event.target.value)}
                            onKeyDown={(event) => controller.handleOtpKeyDown(index, event)}
                            onPaste={index === 0 ? controller.handleOtpPaste : undefined}
                            disabled={otpDisabled}
                            className={cn('h-14 w-11 rounded-[0.9rem] border-2 bg-white/5 text-center text-2xl font-black text-white outline-none transition', digit ? 'border-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.24)]' : 'border-white/10 focus:border-cyan-300')}
                          />
                        ))}
                      </div>
                      <div className="mb-2 text-center">
                        {controller.countdown > 0 ? (
                          <p className="text-xs font-black uppercase text-slate-500">Resend in {controller.countdown}s</p>
                        ) : (
                          <button type="button" onClick={controller.handleResendOtp} disabled={controller.isLoading || otpDisabled} className="text-xs font-black uppercase text-cyan-300 transition hover:text-white disabled:opacity-50"><FormattedMessage id="auth.jsx.text.resend.otp" defaultMessage="Resend OTP" /></button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {controller.step === 'reset-password' ? (
                    <div className="space-y-4">
                      <button type="button" onClick={controller.goBack} className="inline-flex items-center gap-2 text-sm font-black uppercase text-slate-400 transition hover:text-white">
                        <ArrowLeft className="h-4 w-4" /> Back
                      </button>
                      <DesktopInputShell icon={Lock}>
                        <input type={controller.showPassword ? 'text' : 'password'} name="password" value={controller.formData.password} onChange={controller.handleChange} autoComplete="new-password" placeholder="New password" className={fieldClass} />
                      </DesktopInputShell>
                      <DesktopInputShell icon={KeyRound}>
                        <input type={controller.showPassword ? 'text' : 'password'} name="confirmPassword" value={controller.formData.confirmPassword} onChange={controller.handleChange} autoComplete="new-password" placeholder="Confirm password" className={fieldClass} />
                      </DesktopInputShell>
                    </div>
                  ) : null}

                  {controller.turnstileEnabled ? (
                    <TurnstileChallenge action={controller.turnstileAction} disabled={actionDisabled} onError={controller.handleTurnstileError} onToken={controller.handleTurnstileToken} refreshKey={`${controller.turnstileAction}:${controller.turnstileRefreshKey}`} />
                  ) : null}

                  <button type="submit" disabled={actionDisabled} className="group relative mt-1 flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-[1rem] bg-cyan-300 px-5 py-4 text-sm font-black uppercase text-slate-950 shadow-[0_18px_42px_rgba(34,211,238,0.22)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55">
                    {controller.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    {emergencyActionDisabled ? 'Temporarily Unavailable' : controller.submitLabel}
                  </button>
                </form>

                {controller.step === 'form' && controller.mode !== 'forgot-password' ? (
                  <div className="mt-5">
                    <div className="mb-4 flex items-center gap-4">
                      <div className="h-px flex-1 bg-white/10" />
                      <span className="text-xs font-black uppercase text-slate-500">or</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                    {showProviderGrid ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {controller.isDuoLoginEnabled ? (
                          <button type="button" onClick={controller.handleDuoSignIn} disabled={socialDisabled} className={cn(providerButtonClass, 'border-emerald-300/25 bg-emerald-300/10 text-emerald-50 hover:border-emerald-300/50 hover:bg-emerald-300/15 sm:col-span-2')}>
                            <ShieldCheck className="h-5 w-5 text-emerald-300" />
                            Cisco Duo
                          </button>
                        ) : null}
                        {controller.socialAuthStatus.supported ? (
                          <>
                            <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGoogle, 'Google')} disabled={socialDisabled} className={providerButtonClass}><span className="text-lg font-black text-[#4285f4]">G</span>Google</button>
                            <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithFacebook, 'Facebook')} disabled={socialDisabled} className={providerButtonClass}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1877f2] text-sm font-black text-white">f</span>Facebook</button>
                            <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGitHub, 'GitHub')} disabled={socialDisabled} className={providerButtonClass}><Github className="h-5 w-5" />GitHub</button>
                            <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithX, 'X')} disabled={socialDisabled} className={providerButtonClass}><span className="text-lg font-black">X</span>X</button>
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
                                <Apple className="h-5 w-5" />
                                Apple
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {!controller.socialAuthStatus.supported ? (
                      <div className="rounded-[1rem] border border-amber-300/20 bg-amber-300/10 p-4 text-sm font-semibold text-amber-100">
                        Social access is unavailable for this deployment.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs font-black uppercase text-slate-400">
                  <button type="button" onClick={() => controller.switchMode(controller.mode === 'signup' ? 'signin' : 'signup')} disabled={controller.isLoading || signupDisabled} className="transition hover:text-cyan-200 disabled:opacity-50">
                    {controller.mode === 'signup' ? 'Use existing account' : 'Create account'}
                  </button>
                  <span className="inline-flex items-center gap-2 text-emerald-200"><CheckCircle2 className="h-4 w-4" />Desktop handoff active</span>
                </div>
              </>
            )}
          </section>
        </main>

        <footer className="flex items-center justify-center gap-2 pb-2 text-sm font-semibold text-slate-500">
          <ShieldCheck className="h-5 w-5" />
          Aura Desktop keeps your session secure and private.
        </footer>
      </div>
    </div>
  );
};

export default DesktopLogin;
