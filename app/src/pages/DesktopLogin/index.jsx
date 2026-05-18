import { ArrowLeft, CheckCircle2, ChevronDown, Eye, EyeOff, Github, Loader2, Lock, Mail, MonitorCheck, Phone, ShieldCheck, Sparkles, TimerReset, User, Zap } from 'lucide-react';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import TurnstileChallenge from '@/components/features/auth/TurnstileChallenge';
import { useEmergencyStatus } from '@/context/EmergencyStatusContext';
import { cn } from '@/lib/utils';
import { useLoginController } from '@/pages/Login/useLoginController';

const providerButtonClass = 'rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-slate-100 transition hover:border-cyan-300/20 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50';

const desktopSurfaces = [
  { label: 'Gateway', value: 'Request locked' },
  { label: 'Identity', value: 'Verified proof' },
  { label: 'Backend', value: 'Sealed token' },
  { label: 'Bridge', value: 'Loopback only' },
  { label: 'Session', value: 'Desktop only' },
  { label: 'Audit', value: 'Trace ready' },
];

const DesktopMetric = ({ label, value }) => (
  <div className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
    <div className="truncate text-xs font-black uppercase tracking-widest text-slate-500">{label}</div>
    <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
  </div>
);

const DesktopInputShell = ({ icon: Icon, children }) => (
  <div className="group/input relative">
    <Icon className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within/input:text-neo-cyan" />
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
  const stepLabel = controller.step === 'otp'
    ? 'OTP lane'
    : controller.step === 'reset-password'
      ? 'Recovery lane'
      : controller.mode === 'signup'
        ? 'Account lane'
        : 'Credential lane';

  return (
    <div className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 shadow-xl">
              <MonitorCheck className="h-6 w-6 text-cyan-200" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-widest text-cyan-200">Aura Desktop</p>
              <p className="truncate text-xl font-black tracking-tight sm:text-2xl">Secure Browser Sign-In</p>
            </div>
          </div>
          <div className="hidden rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-100 sm:block">
            {handoffActive ? 'Request armed' : 'Request missing'}
          </div>
        </header>

        <div className="grid flex-1 items-center gap-6 py-6 lg:grid-cols-2">
          <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-8" style={{ minHeight: '32rem' }}>
            <img
              src="/assets/login_illustration.png"
              alt=""
              className="absolute bottom-0 right-0 w-auto"
              style={{ height: '20rem', maxHeight: '24rem', opacity: 0.3 }}
            />
            <div className="relative z-10 flex h-full flex-col justify-between gap-8">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200">
                  <Sparkles className="h-4 w-4 text-cyan-200" />
                  {stepLabel}
                </div>
                <h1 className="mt-6 max-w-2xl text-4xl font-black leading-none tracking-tight text-white sm:text-5xl">
                  One focused login bridge for Aura Desktop.
                </h1>
                <p className="mt-5 max-w-xl text-base font-semibold leading-7 text-slate-300">
                  Your browser completes the identity proof, then Aura Desktop receives a sealed session result through the trusted local bridge.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {desktopSurfaces.map((surface) => (
                  <DesktopMetric key={surface.label} label={surface.label} value={surface.value} />
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl sm:p-6">
            {!handoffActive ? (
              <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '32rem' }}>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
                  <TimerReset className="h-8 w-8 text-amber-200" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight">Desktop request not active</h2>
                <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-400">
                  Start again from Aura Desktop so this browser lane can bind to the local session request.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-5 grid grid-cols-3 gap-2">
                  <DesktopMetric label="Delivery" value="Hosted" />
                  <DesktopMetric label="API" value="Protected" />
                  <DesktopMetric label="Callback" value="Loopback" />
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

                <form onSubmit={controller.handleSubmit} className="space-y-4" autoComplete="on">
                  <div ref={controller.recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

                  {controller.step === 'form' ? (
                    <>
                      {controller.mode === 'signup' ? (
                        <div>
                          <label className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-400">Full Name *</label>
                          <DesktopInputShell icon={User}>
                            <input name="name" value={controller.formData.name} onChange={controller.handleChange} autoComplete="name" className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition focus:border-neo-cyan" />
                          </DesktopInputShell>
                        </div>
                      ) : null}

                      {controller.mode !== 'forgot-password' ? (
                        <div>
                          <label className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-400">Email Address *</label>
                          <DesktopInputShell icon={Mail}>
                            <input type="email" name="email" value={controller.formData.email} onChange={controller.handleChange} autoComplete={controller.mode === 'signin' ? 'username' : 'email'} className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition focus:border-neo-cyan" />
                          </DesktopInputShell>
                        </div>
                      ) : null}

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-400">Phone Number *</label>
                        <div className="relative flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition focus-within:border-neo-cyan">
                          <Phone className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-500" />
                          <select value={controller.phoneCountryCode} onChange={controller.handlePhoneCountryChange} aria-label="Country calling code" className="h-full shrink-0 appearance-none border-0 border-r border-white/10 bg-transparent py-4 pl-11 pr-7 text-sm font-black text-white outline-none" style={{ minHeight: '3.5rem', width: '9rem' }}>
                            {controller.phoneCountryOptions.map((option) => (
                              <option key={option.countryCode} value={option.countryCode} className="bg-slate-950 text-white">{option.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" style={{ left: '7rem' }} />
                          <input type="tel" name="phone" value={controller.phoneLocalValue} onChange={controller.handlePhoneChange} autoComplete="tel-national" inputMode="tel" className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 font-bold text-white outline-none" />
                        </div>
                      </div>

                      {controller.mode !== 'forgot-password' ? (
                        <div>
                          <div className="mb-2 flex items-end justify-between gap-3">
                            <label className="block text-xs font-black uppercase tracking-widest text-slate-400">Password *</label>
                            {controller.mode === 'signin' ? (
                              <button type="button" onClick={() => controller.switchMode('forgot-password')} disabled={passwordResetDisabled} className="text-xs font-black uppercase tracking-widest text-cyan-200 transition hover:text-white disabled:opacity-50">Forgot Password?</button>
                            ) : null}
                          </div>
                          <DesktopInputShell icon={Lock}>
                            <input type={controller.showPassword ? 'text' : 'password'} name="password" value={controller.formData.password} onChange={controller.handleChange} autoComplete={controller.mode === 'signup' ? 'new-password' : 'current-password'} className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-14 font-bold text-white outline-none transition focus:border-neo-cyan" />
                            <button type="button" onClick={() => controller.setShowPassword(!controller.showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-white">
                              {controller.showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </DesktopInputShell>
                        </div>
                      ) : (
                        <div>
                          <label className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-400">Registered Email *</label>
                          <DesktopInputShell icon={Mail}>
                            <input type="email" name="email" value={controller.formData.email} onChange={controller.handleChange} autoComplete="email" className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition focus:border-neo-cyan" />
                          </DesktopInputShell>
                        </div>
                      )}

                      {controller.mode === 'signup' ? (
                        <div>
                          <label className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-400">Confirm Password *</label>
                          <DesktopInputShell icon={ShieldCheck}>
                            <input type={controller.showPassword ? 'text' : 'password'} name="confirmPassword" value={controller.formData.confirmPassword} onChange={controller.handleChange} autoComplete="new-password" className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition focus:border-neo-cyan" />
                          </DesktopInputShell>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {controller.step === 'otp' ? (
                    <div>
                      <button type="button" onClick={controller.goBack} className="mb-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 transition hover:text-white">
                        <ArrowLeft className="h-4 w-4" /> Back
                      </button>
                      <div className="mb-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
                        <p className="text-xs font-black uppercase tracking-widest text-cyan-100">{controller.isEmailOtpStage ? 'Email verification' : controller.isPhoneOtpStage ? 'Phone verification' : 'Verification code'}</p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{controller.isEmailOtpStage ? `Code sent to ${controller.formData.email}.` : controller.isPhoneOtpStage ? `Code sent to ${controller.formData.phone}.` : 'Enter the secure OTP to continue.'}</p>
                      </div>
                      <div className="mb-6 flex justify-center gap-2 sm:gap-3">
                        {controller.otpValues.map((digit, index) => (
                          <input key={index} ref={(element) => (controller.otpRefs.current[index] = element)} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} value={digit} onChange={(event) => controller.handleOtpChange(index, event.target.value)} onKeyDown={(event) => controller.handleOtpKeyDown(index, event)} onPaste={index === 0 ? controller.handleOtpPaste : undefined} disabled={otpDisabled} className={cn('h-14 w-11 rounded-xl border-2 bg-white/5 text-center text-2xl font-black text-white outline-none transition', digit ? 'border-neo-cyan shadow-lg' : 'border-white/10 focus:border-neo-cyan')} />
                        ))}
                      </div>
                      <div className="mb-2 text-center">
                        {controller.countdown > 0 ? (
                          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Resend in {controller.countdown}s</p>
                        ) : (
                          <button type="button" onClick={controller.handleResendOtp} disabled={controller.isLoading || otpDisabled} className="text-xs font-black uppercase tracking-widest text-cyan-200 transition hover:text-white disabled:opacity-50">Resend OTP</button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {controller.step === 'reset-password' ? (
                    <div className="space-y-4">
                      <button type="button" onClick={controller.goBack} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 transition hover:text-white">
                        <ArrowLeft className="h-4 w-4" /> Back
                      </button>
                      <DesktopInputShell icon={Lock}>
                        <input type={controller.showPassword ? 'text' : 'password'} name="password" value={controller.formData.password} onChange={controller.handleChange} autoComplete="new-password" placeholder="New password" className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-neo-cyan" />
                      </DesktopInputShell>
                      <DesktopInputShell icon={ShieldCheck}>
                        <input type={controller.showPassword ? 'text' : 'password'} name="confirmPassword" value={controller.formData.confirmPassword} onChange={controller.handleChange} autoComplete="new-password" placeholder="Confirm password" className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-neo-cyan" />
                      </DesktopInputShell>
                    </div>
                  ) : null}

                  {controller.turnstileEnabled ? (
                    <TurnstileChallenge action={controller.turnstileAction} disabled={actionDisabled} onError={controller.handleTurnstileError} onToken={controller.handleTurnstileToken} refreshKey={`${controller.turnstileAction}:${controller.turnstileRefreshKey}`} />
                  ) : null}

                  <button type="submit" disabled={actionDisabled} className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black uppercase tracking-widest text-slate-950 shadow-xl transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-55">
                    {controller.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    {emergencyActionDisabled ? 'Temporarily Unavailable' : controller.submitLabel}
                  </button>
                </form>

                {controller.step === 'form' && controller.mode !== 'forgot-password' ? (
                  <div className="mt-5">
                    <div className="mb-4 flex items-center gap-4">
                      <div className="h-px flex-1 bg-white/10" />
                      <span className="text-xs font-black uppercase tracking-widest text-slate-500">or</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                    {controller.socialAuthStatus.supported ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGoogle, 'Google')} disabled={socialDisabled} className={providerButtonClass}>Google</button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithFacebook, 'Facebook')} disabled={socialDisabled} className={providerButtonClass}>Facebook</button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithGitHub, 'GitHub')} disabled={socialDisabled} className={providerButtonClass}><Github className="mr-2 inline h-4 w-4" />GitHub</button>
                        <button type="button" onClick={() => controller.handleSocialSignIn(controller.signInWithX, 'X')} disabled={socialDisabled} className={providerButtonClass}>X</button>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm font-semibold text-amber-100">
                        Social access is unavailable for this deployment.
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs font-black uppercase tracking-widest text-slate-500">
                  <button type="button" onClick={() => controller.switchMode(controller.mode === 'signup' ? 'signin' : 'signup')} disabled={controller.isLoading || signupDisabled} className="transition hover:text-cyan-200 disabled:opacity-50">
                    {controller.mode === 'signup' ? 'Use existing account' : 'Create account'}
                  </button>
                  <span className="inline-flex items-center gap-2 text-emerald-200"><CheckCircle2 className="h-4 w-4" />Desktop handoff active</span>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default DesktopLogin;
