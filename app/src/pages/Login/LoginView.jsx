import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Eye, EyeOff, Loader2, Lock, Mail, Network, Phone, Shield, User, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import AuthAccelerationRail from '@/components/features/auth/AuthAccelerationRail';
import { AuthFeedback } from '@/components/shared/AuthFeedback';

const LoginView = ({
  OTP_TRANSPORT,
  accelerationCards,
  authError,
  authSuccess,
  canUseFirebasePhoneOtp,
  countdown,
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
  handleSocialSignIn,
  handleSubmit,
  info,
  isEmailOtpStage,
  isLoading,
  isPhoneOtpStage,
  mode,
  otpRefs,
  otpTransport,
  otpValues,
  phoneCountryCode,
  phoneCountryOptions,
  phoneLocalValue,
  recaptchaContainerRef,
  secureSignals,
  selectedPhoneCountry,
  setShowPassword,
  showPassword,
  signInWithFacebook,
  signInWithGoogle,
  signInWithX,
  socialAuthStatus,
  step,
  submitLabel,
  switchMode,
  t,
  trustNotes,
}) => (
  <div className="login-theme-shell min-h-[calc(100vh-var(--figma-nav-spacer-mobile))] pb-8 pt-4 sm:min-h-[calc(100vh-var(--figma-nav-spacer-sm))] sm:pb-12 sm:pt-6 md:min-h-[calc(100vh-var(--figma-nav-spacer-md))] md:pb-20 md:pt-8 relative flex items-center justify-center overflow-hidden">
    <div className="login-theme-shell__base absolute inset-0 bg-zinc-950 z-0" />
    <div className="login-theme-shell__center-glow absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.1)_0%,transparent_50%)] pointer-events-none z-0" />
    <div className="login-theme-shell__aura login-theme-shell__aura--primary absolute top-1/4 left-1/4 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/10 rounded-full blur-[120px] pointer-events-none z-0 mix-blend-screen" />
    <div className="login-theme-shell__aura login-theme-shell__aura--secondary absolute bottom-1/4 right-1/4 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-fuchsia/10 rounded-full blur-[120px] pointer-events-none z-0 mix-blend-screen" />
    <div className="login-theme-shell__grid absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px] pointer-events-none z-0 opacity-50" />

    <div className="container-custom relative z-10">
      <div className="max-w-5xl mx-auto">
        <div className="login-card bg-white/5 rounded-[28px] sm:rounded-[40px] shadow-glass overflow-hidden border border-white/10 flex flex-col md:flex-row relative group hover:border-neo-cyan/30 hover:shadow-[0_0_40px_rgba(6,182,212,0.15)] transition-all duration-700">
          <div className="login-card__chromatic absolute inset-0 bg-gradient-to-r from-neo-cyan/10 via-neo-fuchsia/10 to-neo-emerald/10 opacity-0 group-hover:opacity-100 animate-gradient-x transition-opacity duration-700 pointer-events-none" style={{ backgroundSize: '200% auto' }} />
          <div className="login-card__shine absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none z-0" />

          <div className="login-brand-panel md:w-[45%] bg-zinc-950/80 p-6 sm:p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
            <div className="login-brand-panel__glow absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(217,70,239,0.1),transparent)] pointer-events-none" />
            <div className="login-brand-panel__texture absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20 mix-blend-overlay pointer-events-none" />

            <div className="relative z-10">
              <Link to="/" className="login-brand-lockup inline-flex items-center gap-2 mb-8 sm:mb-12 lg:mb-20 hover:opacity-80 transition-opacity">
                <div className="login-brand-mark w-10 h-10 bg-gradient-to-br from-neo-cyan to-neo-fuchsia rounded-xl p-[2px] shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                  <div className="login-brand-mark__inner w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
                    <span className="text-white font-black mix-blend-screen">Ar</span>
                  </div>
                </div>
                <span className="text-xl font-black uppercase tracking-widest text-white">Aura</span>
              </Link>

              <h1 className="login-brand-title text-3xl sm:text-4xl lg:text-5xl font-black mb-6 text-transparent bg-clip-text bg-gradient-to-r from-neo-cyan to-white tracking-tighter leading-tight drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                {info.title}
              </h1>
              <p className="login-brand-copy text-slate-400 font-medium text-base sm:text-lg leading-relaxed max-w-md border-l-2 border-neo-cyan pl-4">
                {info.desc}
              </p>

              <div className="mt-8 grid gap-3 max-w-md">
                {trustNotes.map((note) => (
                  <div
                    key={note}
                    className="login-trust-note rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300/95 shadow-[0_12px_30px_rgba(2,8,23,0.25)]"
                  >
                    <span className="mr-2 text-neo-cyan">?</span>
                    {note}
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden md:flex relative z-10 items-center justify-center p-8 mt-10">
              {step === 'otp' || step === 'reset-password' ? (
                <Shield className="w-40 h-40 text-neo-cyan/20 drop-shadow-[0_0_30px_rgba(6,182,212,0.4)] animate-spin-slow" />
              ) : (
                <Network className="w-40 h-40 text-neo-fuchsia/20 drop-shadow-[0_0_30px_rgba(217,70,239,0.4)] animate-spin-slow" />
              )}
            </div>
          </div>

          <div className="login-form-panel md:w-[55%] p-6 sm:p-8 lg:p-14 relative z-10 flex flex-col justify-center bg-transparent">
            <AuthAccelerationRail cards={accelerationCards} busy={isLoading} />

            <div className="login-secure-panel mb-6 rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_45px_rgba(2,8,23,0.28)]">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">
                <Shield className="h-4 w-4" />
                {t('login.secureEntry', {}, 'Secure Entry Layer')}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {secureSignals.map((signal) => (
                  <div
                    key={signal.label}
                    className="login-signal-card rounded-2xl border border-white/8 bg-zinc-950/45 px-3 py-3"
                  >
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                      {signal.label}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {signal.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {authError && (
              <div className="mb-6">
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
              <div className="mb-6">
                <AuthFeedback
                  type="success"
                  title={authSuccess.title}
                  detail={authSuccess.detail}
                />
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
              <div ref={recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

              {step === 'form' && (
                <>
                  {mode === 'signup' && (
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.fullName', {}, 'Full Name')} *</label>
                      <div className="relative group/input">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder={t('login.placeholder.fullName', {}, 'John Doe')} autoComplete="name"
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                      </div>
                    </div>
                  )}

                  {mode !== 'forgot-password' && (
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.email', {}, 'Email Address')} *</label>
                      <div className="relative group/input">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder={t('login.placeholder.email', {}, 'you@example.com')} autoComplete={mode === 'signin' ? 'username' : 'email'}
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                      </div>
                    </div>
                  )}

                  <div className="animate-fade-in">
                    <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.phone', {}, 'Phone Number')} *</label>
                    <div className="relative group/input grid grid-cols-[minmax(7.75rem,8.5rem),minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/50 shadow-inner transition-all focus-within:border-neo-cyan focus-within:ring-1 focus-within:ring-neo-cyan">
                      <Phone className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within/input:text-neo-cyan" />
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
                        className="h-full min-h-[3.5rem] w-full appearance-none border-0 border-r border-white/10 bg-transparent py-4 pl-11 pr-7 text-sm font-black text-white outline-none transition-colors focus:bg-white/[0.03]"
                      >
                        {phoneCountryOptions.map((option) => (
                          <option key={option.countryCode} value={option.countryCode} className="bg-zinc-950 text-white">
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute left-[6.85rem] top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input
                        type="tel"
                        name="phone"
                        value={phoneLocalValue}
                        onChange={handlePhoneChange}
                        placeholder={t('login.placeholder.phoneLocal', {}, 'Phone number')}
                        autoComplete="tel-national"
                        inputMode="tel"
                        aria-label={`${t('login.field.phone', {}, 'Phone Number')} ${selectedPhoneCountry?.dialCode || ''}`}
                        className="min-w-0 border-0 bg-transparent px-4 py-4 font-medium text-white outline-none placeholder:text-slate-600"
                      />
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1.5 uppercase tracking-widest font-bold pl-1">
                      {firebasePhoneFallback?.disableFirebasePhoneOtp
                        ? t('login.phoneHint.fallback', {}, 'Firebase SMS is unavailable here. Secure backup OTP will be sent through the available secure verification channel instead.')
                        : canUseFirebasePhoneOtp
                          ? mode === 'signup'
                            ? t('login.phoneHint.signup', {}, 'Signup sends one code to email and one Firebase SMS code to your phone.')
                            : mode === 'forgot-password'
                              ? t('login.phoneHint.forgot', {}, 'Recovery sends one code to email and one Firebase SMS code to your phone.')
                              : t('login.phoneHint.signin', {}, 'Sign-in sends one code to email and one Firebase SMS code to your phone.')
                        : t('login.phoneHint.default', {}, 'OTP will be sent to your email & phone')}
                    </p>
                  </div>

                  {mode !== 'forgot-password' && (
                    <div className="animate-fade-in">
                      <div className="flex justify-between items-end mb-2">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400">{t('login.field.password', {}, 'Password')} *</label>
                        {mode === 'signin' && (
                          <button type="button" onClick={() => switchMode('forgot-password')}
                            className="text-neo-cyan text-xs font-bold uppercase tracking-widest hover:text-neo-fuchsia transition-colors">
                            {t('login.action.forgotPassword', {}, 'Forgot Password?')}
                          </button>
                        )}
                      </div>
                      <div className="relative group/input">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} placeholder="........" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          className="w-full pl-12 pr-14 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {mode === 'signup' && (
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.confirmPassword', {}, 'Confirm Password')} *</label>
                      <div className="relative group/input">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type={showPassword ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} placeholder="........" autoComplete="new-password"
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                      </div>
                    </div>
                  )}

                  {mode === 'forgot-password' && (
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.registeredEmail', {}, 'Registered Email')} *</label>
                      <div className="relative group/input">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder={t('login.placeholder.email', {}, 'you@example.com')} autoComplete="email"
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 'otp' && (
                <div className="animate-fade-in">
                  <button type="button" onClick={goBack}
                    className="flex items-center gap-2 text-slate-400 hover:text-white text-xs uppercase tracking-widest font-bold mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> {t('login.action.backToForm', {}, 'Back to form')}
                  </button>

                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-neo-cyan/20 to-neo-fuchsia/20 border border-white/10 flex items-center justify-center">
                      <Shield className="w-8 h-8 text-neo-cyan" />
                    </div>
                    <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">{t('login.otp.title', {}, 'Enter Verification Code')}</h3>
                    {isEmailOtpStage ? (
                      <p className="text-slate-400 text-sm">
                        {t('login.otp.emailStepPrefix', {}, 'Step 1 of 2. We sent a 6-digit email code to')} <span className="text-white font-bold">{formData.email}</span>.
                        {' '}
                        {mode === 'signup'
                          ? <>{t('login.otp.emailStepSignupPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepSignupSuffix', {}, 'will finish activating this account next.')}</>
                          : mode === 'forgot-password'
                            ? <>{t('login.otp.emailStepForgotPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepForgotSuffix', {}, 'will unlock password recovery next.')}</>
                            : <>{t('login.otp.emailStepSigninPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepSigninSuffix', {}, 'will complete the same login next.')}</>}
                      </p>
                    ) : isPhoneOtpStage ? (
                      <p className="text-slate-400 text-sm">
                        {t('login.otp.phoneStepPrefix', {}, 'Step 2 of 2. Your email is verified. Enter the Firebase SMS code sent to')} <span className="text-white font-bold">{formData.phone}</span>{' '}
                        {mode === 'signup'
                          ? t('login.otp.phoneStepSignup', {}, 'to activate the account.')
                          : mode === 'forgot-password'
                            ? t('login.otp.phoneStepForgot', {}, 'to continue password recovery.')
                            : t('login.otp.phoneStepSignin', {}, 'to finish signing in.')}
                      </p>
                    ) : otpTransport === OTP_TRANSPORT.FIREBASE_SMS ? (
                      <p className="text-slate-400 text-sm">
                        {t('login.otp.firebaseSent', {}, 'We sent a 6-digit Firebase SMS code to')} <span className="text-white font-bold">{formData.phone}</span>.
                      </p>
                    ) : (
                      <p className="text-slate-400 text-sm">
                        {t('login.otp.defaultSent', {}, 'We sent a 6-digit code to')} <span className="text-white font-bold">{formData.email}</span>
                        {formData.phone && <> {t('login.otp.and', {}, 'and')} <span className="text-white font-bold">{formData.phone}</span></>}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-center gap-2 sm:gap-3 mb-8">
                    {otpValues.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => (otpRefs.current[index] = element)}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        maxLength={1}
                        value={digit}
                        onChange={(event) => handleOtpChange(index, event.target.value)}
                        onKeyDown={(event) => handleOtpKeyDown(index, event)}
                        onPaste={index === 0 ? handleOtpPaste : undefined}
                        className={cn(
                          'w-10 h-12 sm:w-12 sm:h-14 md:w-14 md:h-16 text-center text-2xl font-black rounded-xl border-2 bg-zinc-950/50 text-white outline-none transition-all duration-300',
                          digit
                            ? 'border-neo-cyan shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                            : 'border-white/10 focus:border-neo-cyan focus:ring-2 focus:ring-neo-cyan/50 focus:shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                        )}
                      />
                    ))}
                  </div>

                  <div className="text-center mb-4">
                    {countdown > 0 ? (
                      <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">
                        {t('login.otp.resendIn', { seconds: countdown }, 'Resend in {{seconds}}s')}
                      </p>
                    ) : (
                      <button type="button" onClick={handleResendOtp} disabled={isLoading}
                        className="text-neo-cyan text-xs uppercase tracking-widest font-bold hover:text-white transition-colors">
                        {t('login.otp.resend', {}, 'Resend OTP')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step === 'reset-password' && (
                <div className="animate-fade-in">
                  <button type="button" onClick={goBack}
                    className="flex items-center gap-2 text-slate-400 hover:text-white text-xs uppercase tracking-widest font-bold mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> {t('login.action.backToForm', {}, 'Back to form')}
                  </button>

                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-neo-cyan/20 to-neo-fuchsia/20 border border-white/10 flex items-center justify-center">
                      <Lock className="w-8 h-8 text-neo-cyan" />
                    </div>
                    <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">{t('login.reset.title', {}, 'Create New Password')}</h3>
                    <p className="text-slate-400 text-sm">
                      {t('login.reset.bodyPrefix', {}, 'Recovery is verified for')} <span className="text-white font-bold">{formData.email}</span>.
                      {' '}
                      {t('login.reset.bodySuffix', {}, 'Set a strong new password for the account tied to')} <span className="text-white font-bold">{formData.phone}</span>.
                    </p>
                  </div>

                  <div className="space-y-5">
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.newPassword', {}, 'New Password')} *</label>
                      <div className="relative group/input">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          name="password"
                          value={formData.password}
                          onChange={handleChange}
                          placeholder="........"
                          autoComplete="new-password"
                          className="w-full pl-12 pr-14 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>

                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.confirmPassword', {}, 'Confirm Password')} *</label>
                      <div className="relative group/input">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          name="confirmPassword"
                          value={formData.confirmPassword}
                          onChange={handleChange}
                          placeholder="........"
                          autoComplete="new-password"
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  'w-full btn-primary py-4 sm:py-5 mt-2 text-sm sm:text-base tracking-[0.2em] relative overflow-hidden group/submit shadow-[0_0_20px_rgba(6,182,212,0.3)]',
                  isLoading && 'opacity-70 cursor-wait'
                )}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-3 relative z-10 text-white">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('login.processing', {}, 'PROCESSING...')}
                  </span>
                ) : (
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {submitLabel}
                    <Zap className="w-5 h-5 fill-white group-hover/submit:animate-pulse" />
                  </span>
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-fuchsia opacity-0 group-hover/submit:opacity-40 transition-opacity duration-300 pointer-events-none" />
              </button>
            </form>

            {step === 'form' && mode !== 'forgot-password' && (
              <div className="mt-6 animate-fade-in">
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">{t('login.or', {}, 'or')}</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                </div>
                {socialAuthStatus.supported ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => handleSocialSignIn(signInWithGoogle, 'Google')}
                      disabled={isLoading}
                      className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      Google
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSocialSignIn(signInWithFacebook, 'Facebook')}
                      disabled={isLoading}
                      className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-[#1877F2]/15 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-[#1877F2]/40"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.926v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.686 4.533-4.686 1.312 0 2.686.235 2.686.235v2.96h-1.513c-1.491 0-1.956.93-1.956 1.884v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073z" />
                      </svg>
                      Facebook
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSocialSignIn(signInWithX, 'X')}
                      disabled={isLoading}
                      className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/30"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M18.244 2H21l-6.54 7.475L22 22h-5.828l-4.566-5.964L6.39 22H3.633l7-8.002L2 2h5.977l4.127 5.446L18.244 2Zm-1.021 18.285h1.527L7.147 3.624H5.507l11.716 16.661Z" />
                      </svg>
                      X
                    </button>
                  </div>
                ) : socialAuthStatus.ready ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-amber-300">
                      {socialAuthStatus.runtimeBlocked
                        ? t('login.social.paused', {}, 'Social sign-in paused on this tab')
                        : socialAuthStatus.disabledByMobileNativeConfig
                          ? t('login.social.mobileConfigTitle', {}, 'Mobile social sign-in needs native config')
                        : t('login.social.disabledHost', {}, 'Social sign-in is disabled on this host')}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {socialAuthStatus.runtimeBlocked ? (
                        <>
                          {t('login.social.runtimeBlockedPrefix', {}, 'Firebase rejected popup sign-in for')}{' '}
                          <span className="font-semibold text-slate-200">{socialAuthStatus.runtimeHost || t('login.social.thisDomain', {}, 'this domain')}</span>{' '}
                          {t('login.social.runtimeBlockedSuffix', {}, 'in this tab. Refresh after confirming the domain is authorized, or continue with email and OTP now.')}
                        </>
                      ) : socialAuthStatus.disabledByMobileNativeConfig ? (
                        <>
                          {t('login.social.mobileConfigBody', {}, 'The installed app is using the stable email and OTP lane until Android/iOS OAuth credentials are attached to the native build.')}
                        </>
                      ) : (
                        <>
                          {t('login.social.enablePrefix', {}, 'Use email and OTP sign-in here. To enable Google, Facebook, and X, authorize')}{' '}
                          <span className="font-semibold text-slate-200">{socialAuthStatus.runtimeHost || t('login.social.thisDomain', {}, 'this domain')}</span>{' '}
                          {t('login.social.enableSuffix', {}, 'in Firebase Authentication settings.')}
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-rose-300">
                      {t('login.social.unavailable', {}, 'Social sign-in is unavailable on this deployment')}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {t('login.social.unavailableBody', {}, 'Firebase authentication did not initialize cleanly for this frontend build. Email and OTP sign-in remain available.')}
                    </p>
                    {socialAuthStatus.initErrorCode && (
                      <p className="mt-2 text-[11px] text-slate-500">
                        {t('login.social.runtimeCode', {}, 'Runtime code:')} <span className="font-semibold text-slate-300">{socialAuthStatus.initErrorCode}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-10 pt-8 border-t border-white/10 text-center space-y-3">
              {mode === 'forgot-password' ? (
                <p className="text-slate-400 font-medium uppercase tracking-widest text-xs">
                  {t('login.modeToggle.rememberPassword', {}, 'Remember your password?')}
                  <button onClick={() => switchMode('signin')}
                    className="ml-2 text-white font-bold hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 decoration-2 underline-offset-4">
                    {t('login.mode.signin.cta', {}, 'Sign In')}
                  </button>
                </p>
              ) : (
                <p className="text-slate-400 font-medium uppercase tracking-widest text-xs">
                  {mode === 'signin'
                    ? t('login.modeToggle.noAccount', {}, "Don't have an account?")
                    : t('login.modeToggle.haveAccount', {}, 'Already have an account?')}
                  <button onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                    className="ml-2 text-white font-bold hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 decoration-2 underline-offset-4">
                    {mode === 'signin' ? t('login.mode.signup.cta', {}, 'Sign Up') : t('login.mode.signin.cta', {}, 'Sign In')}
                  </button>
                </p>
              )}
            </div>

            <p className="mt-8 text-xs font-bold text-slate-600 text-center uppercase tracking-widest max-w-sm mx-auto leading-relaxed">
              {t('login.terms.prefix', {}, 'By continuing, you accept our')}{' '}
              <Link to="/terms" className="text-slate-400 hover:text-white transition-colors underline decoration-white/30 decoration-1 underline-offset-2">{t('login.terms.use', {}, 'Terms of Use')}</Link>{' '}
              {t('login.terms.middle', {}, 'and allow')}{' '}
              <Link to="/privacy" className="text-slate-400 hover:text-white transition-colors underline decoration-white/30 decoration-1 underline-offset-2">{t('login.terms.privacy', {}, 'Privacy Policy')}</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default LoginView;
