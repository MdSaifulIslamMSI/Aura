import { useState, useContext, useRef, useEffect } from 'react';
import { X, Mail, Lock, User, Phone, Zap, Shield, ArrowLeft, Loader2 } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { otpApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import { resolveAuthError, AUTH_SUCCESS } from '@/utils/authErrors';
import { verifyCredentialsWithoutSession } from '@/utils/precheckCredentials';

const OTP_LENGTH = 6;

const LoginModal = ({ isOpen, onClose }) => {
    const { login, signup, forgotPassword, signInWithGoogle, signInWithFacebook, signInWithX } = useContext(AuthContext);

    const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot-password'
    const [step, setStep] = useState('form');    // 'form' | 'otp'
    const [isLoading, setIsLoading] = useState(false);
    const [authError, setAuthError] = useState(null);
    const [authSuccess, setAuthSuccess] = useState(null);
    const [countdown, setCountdown] = useState(0);
    const [signInProofToken, setSignInProofToken] = useState('');

    const [formData, setFormData] = useState({
        name: '', email: '', phone: '', password: '', confirmPassword: ''
    });

    const [otpValues, setOtpValues] = useState(Array(OTP_LENGTH).fill(''));
    const otpRefs = useRef([]);

    // Countdown timer
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    useEffect(() => {
        if (!isOpen) {
            setSignInProofToken('');
            setStep('form');
            setAuthError(null);
            setAuthSuccess(null);
            setCountdown(0);
            setOtpValues(Array(OTP_LENGTH).fill(''));
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
        setAuthError(null);
    };

    // OTP handlers
    const handleOtpChange = (index, value) => {
        if (!/^\d*$/.test(value)) return;
        const newOtp = [...otpValues];
        newOtp[index] = value.slice(-1);
        setOtpValues(newOtp);
        setAuthError(null);
        if (value && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
    };

    const handleOtpKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !otpValues[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    const handleOtpPaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
        const newOtp = [...otpValues];
        pasted.split('').forEach((digit, i) => { newOtp[i] = digit; });
        setOtpValues(newOtp);
        otpRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
    };

    const validatePhone = (phone) => /^\+?\d{10,15}$/.test(phone.replace(/[\s\-\(\)]/g, ''));
    const normalizePhone = (phone) => phone.replace(/[\s\-\(\)]/g, '').trim();
    const normalizeEmail = (email) => email.trim().toLowerCase();
    const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

    const setErr = (rawErr) => setAuthError(resolveAuthError(rawErr));

    const validateForm = () => {
        if (!formData.phone || !validatePhone(formData.phone)) {
            setErr({ message: 'Valid phone number is required' }); return false;
        }
        if (mode === 'signup') {
            if (!formData.name) { setErr({ message: 'Full name is required' }); return false; }
            if (!formData.email) { setErr({ message: 'Email address is required' }); return false; }
            if (!validateEmail(formData.email)) { setErr({ message: 'Valid email address is required' }); return false; }
            if (!formData.password || formData.password.length < 6) { setErr({ message: 'Password must be at least 6 characters' }); return false; }
            if (formData.password !== formData.confirmPassword) { setErr({ message: 'Passwords do not match' }); return false; }
        }
        if (mode === 'signin') {
            if (!formData.email) { setErr({ message: 'Email address is required' }); return false; }
            if (!validateEmail(formData.email)) { setErr({ message: 'Valid email address is required' }); return false; }
            if (!formData.password) { setErr({ message: 'Password is required' }); return false; }
        }
        if (mode === 'forgot-password') {
            if (!formData.email) { setErr({ message: 'Email address is required' }); return false; }
            if (!validateEmail(formData.email)) { setErr({ message: 'Valid email address is required' }); return false; }
        }
        return true;
    };

    const handleSendOtp = async () => {
        if (!validateForm()) return;
        setIsLoading(true);
        setAuthError(null);
        setAuthSuccess(null);
        try {
            const email = normalizeEmail(formData.email);
            const phone = normalizePhone(formData.phone);
            let credentialProofToken = '';
            if (mode === 'signin') {
                try {
                    const precheck = await verifyCredentialsWithoutSession(email, formData.password);
                    credentialProofToken = precheck?.credentialProofToken || '';
                    if (!credentialProofToken) {
                        throw new Error('Unable to verify credentials for secure OTP flow.');
                    }
                    setSignInProofToken(credentialProofToken);
                } catch (firebaseErr) {
                    setErr(firebaseErr);
                    setIsLoading(false);
                    return;
                }
            }
            const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';
            await otpApi.sendOtp(email, phone, purpose, {
                ...(mode === 'signin' ? { credentialProofToken } : {}),
            });
            setStep('otp');
            setOtpValues(Array(OTP_LENGTH).fill(''));
            setCountdown(60);
            setAuthSuccess(AUTH_SUCCESS.otp_sent);
            setTimeout(() => otpRefs.current[0]?.focus(), 300);
        } catch (err) {
            setErr(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        const otp = otpValues.join('');
        if (otp.length !== OTP_LENGTH) { setErr({ message: 'Enter complete 6-digit OTP' }); return; }
        setIsLoading(true);
        setAuthError(null);
        setAuthSuccess(null);
        try {
            const email = normalizeEmail(formData.email);
            const phone = normalizePhone(formData.phone);
            const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';
            await otpApi.verifyOtp(phone, otp, purpose);

            if (mode === 'signup') {
                await signup(email, formData.password, formData.name.trim(), phone);
                setAuthSuccess(AUTH_SUCCESS.signup_success);
                setTimeout(() => onClose(), 1200);
            } else if (mode === 'signin') {
                await login(email, formData.password);
                setAuthSuccess(AUTH_SUCCESS.signin_success);
                setTimeout(() => onClose(), 1200);
            } else {
                await forgotPassword(email);
                setAuthSuccess(AUTH_SUCCESS.reset_sent);
                setTimeout(() => { setMode('signin'); setStep('form'); }, 3000);
            }
            setSignInProofToken('');
        } catch (err) {
            setErr(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (countdown > 0) return;
        setIsLoading(true);
        setAuthError(null);
        try {
            const email = normalizeEmail(formData.email);
            const phone = normalizePhone(formData.phone);
            const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';
            if (mode === 'signin' && !signInProofToken) {
                setErr({ message: 'Secure sign-in proof expired. Please re-enter credentials.' });
                setStep('form');
                setIsLoading(false);
                return;
            }
            await otpApi.sendOtp(email, phone, purpose, {
                ...(mode === 'signin' ? { credentialProofToken: signInProofToken } : {}),
            });
            setCountdown(60);
            setOtpValues(Array(OTP_LENGTH).fill(''));
            setAuthSuccess(AUTH_SUCCESS.otp_resent);
            otpRefs.current[0]?.focus();
        } catch (err) { setErr(err); }
        finally { setIsLoading(false); }
    };

    const switchMode = (m) => {
        setMode(m); setStep('form'); setAuthError(null); setAuthSuccess(null);
        setOtpValues(Array(OTP_LENGTH).fill(''));
        setFormData({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
        setSignInProofToken('');
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        step === 'form' ? handleSendOtp() : handleVerifyOtp();
    };

    const handleSocialSignIn = async (providerSignIn) => {
        setIsLoading(true);
        setAuthError(null);
        setAuthSuccess(null);
        try {
            const result = await providerSignIn();
            if (result?.dbUser) {
                setAuthSuccess(AUTH_SUCCESS.signin_success);
                setTimeout(() => onClose(), 1200);
            } else {
                onClose();
            }
        } catch (err) {
            setErr(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />

            <div className="bg-white/5 backdrop-blur-2xl rounded-[32px] shadow-glass border border-white/10 w-full max-w-md relative overflow-hidden z-10 animate-scale-up shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />

                {/* Header */}
                <div className="relative z-10 p-6 pb-0 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-neo-cyan to-neo-fuchsia rounded-lg p-[2px]">
                            <div className="w-full h-full bg-zinc-950 rounded-[6px] flex items-center justify-center">
                                <span className="text-white font-black text-xs">Ar</span>
                            </div>
                        </div>
                        <span className="text-sm font-black uppercase tracking-widest text-white">
                            {step === 'otp' ? 'Verify OTP' : mode === 'signup' ? 'Sign Up' : mode === 'forgot-password' ? 'Reset Password' : 'Sign In'}
                        </span>
                    </div>
                    <button onClick={onClose}
                        className="text-slate-500 hover:text-white bg-zinc-950/50 hover:bg-zinc-900 border border-white/10 rounded-full p-2 transition-all duration-300 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Form */}
                <div className="relative z-10 p-6">
                    {/* Error */}
                    {authError && (
                        <AuthFeedback
                            compact
                            type="error"
                            title={authError.title}
                            detail={authError.detail}
                            hint={authError.hint}
                            actionLabel={authError.actionLabel}
                            onAction={authError.action ? () => switchMode(authError.action) : undefined}
                        />
                    )}

                    {authSuccess && (
                        <AuthFeedback
                            compact
                            type="success"
                            title={authSuccess.title}
                            detail={authSuccess.detail}
                        />
                    )}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        {step === 'form' && (
                            <>
                                {mode === 'signup' && (
                                    <div className="relative group/input animate-fade-in">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                        <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Full Name *"
                                            className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                    </div>
                                )}

                                {mode !== 'forgot-password' && (
                                    <div className="relative group/input">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                        <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Email Address *"
                                            className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                    </div>
                                )}

                                <div className="relative group/input">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                    <input type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="Phone Number * (e.g. +91 98765 43210)"
                                        className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                </div>

                                {mode !== 'forgot-password' && (
                                    <div className="relative group/input">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                        <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Password *"
                                            className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                    </div>
                                )}

                                {mode === 'signup' && (
                                    <div className="relative group/input animate-fade-in">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                        <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} placeholder="Confirm Password *"
                                            className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                    </div>
                                )}

                                {mode === 'forgot-password' && (
                                    <div className="relative group/input animate-fade-in">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                                        <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Registered Email *"
                                            className="w-full pl-11 pr-4 py-3.5 bg-zinc-950/50 border border-white/10 rounded-xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all text-sm" required />
                                    </div>
                                )}

                                {mode === 'signin' && (
                                    <button type="button" onClick={() => switchMode('forgot-password')}
                                        className="text-neo-cyan text-[10px] font-bold uppercase tracking-widest hover:text-neo-fuchsia transition-colors text-right -mt-1">
                                        Forgot Password?
                                    </button>
                                )}
                            </>
                        )}

                        {step === 'otp' && (
                            <div className="animate-fade-in">
                                <button type="button" onClick={() => { setStep('form'); setAuthError(null); setAuthSuccess(null); setSignInProofToken(''); }}
                                    className="flex items-center gap-1 text-slate-400 hover:text-white text-[10px] uppercase tracking-widest font-bold mb-4 transition-colors">
                                    <ArrowLeft className="w-3 h-3" /> Back
                                </button>

                                <div className="text-center mb-6">
                                    <Shield className="w-10 h-10 mx-auto mb-3 text-neo-cyan" />
                                    <p className="text-slate-400 text-xs">
                                        Code sent to <span className="text-white font-bold">{formData.email}</span>
                                    </p>
                                </div>

                                <div className="flex justify-center gap-2 mb-4">
                                    {otpValues.map((digit, i) => (
                                        <input key={i} ref={el => (otpRefs.current[i] = el)}
                                            type="text" inputMode="numeric" maxLength={1} value={digit}
                                            onChange={e => handleOtpChange(i, e.target.value)}
                                            onKeyDown={e => handleOtpKeyDown(i, e)}
                                            onPaste={i === 0 ? handleOtpPaste : undefined}
                                            className={cn(
                                                'w-10 h-12 text-center text-xl font-black rounded-lg border-2 bg-zinc-950/50 text-white outline-none transition-all',
                                                digit ? 'border-neo-cyan shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'border-white/10 focus:border-neo-cyan'
                                            )} />
                                    ))}
                                </div>

                                <div className="text-center">
                                    {countdown > 0 ? (
                                        <p className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Resend in <span className="text-neo-cyan">{countdown}s</span></p>
                                    ) : (
                                        <button type="button" onClick={handleResendOtp}
                                            className="text-neo-cyan text-[10px] uppercase tracking-widest font-bold hover:text-white transition-colors">
                                            Resend OTP
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <button type="submit" disabled={isLoading}
                            className={cn('w-full btn-primary py-3.5 mt-1 text-sm tracking-[0.2em] relative overflow-hidden group/submit shadow-[0_0_20px_rgba(6,182,212,0.3)]', isLoading && 'opacity-70 cursor-wait')}>
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2 relative z-10 text-white">
                                    <Loader2 className="w-4 h-4 animate-spin" /> PROCESSING...
                                </span>
                            ) : (
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {step === 'otp' ? 'VERIFY OTP' : 'SEND OTP'}
                                    <Zap className="w-4 h-4 fill-white group-hover/submit:animate-pulse" />
                                </span>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-fuchsia opacity-0 group-hover/submit:opacity-40 transition-opacity duration-300 pointer-events-none" />
                        </button>

                        {/* OR + Social */}
                        {step === 'form' && mode !== 'forgot-password' && (
                            <div className="mt-4 animate-fade-in">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-bold text-slate-500">or</span>
                                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleSocialSignIn(signInWithGoogle)}
                                        disabled={isLoading}
                                        className="w-full py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-[10px] tracking-[0.12em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                                    >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                        </svg>
                                        Google
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleSocialSignIn(signInWithFacebook)}
                                        disabled={isLoading}
                                        className="w-full py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-[#1877F2]/15 text-white font-bold text-[10px] tracking-[0.12em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-[#1877F2]/40"
                                    >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                                            <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.926v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.686 4.533-4.686 1.312 0 2.686.235 2.686.235v2.96h-1.513c-1.491 0-1.956.93-1.956 1.884v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073z" />
                                        </svg>
                                        Facebook
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleSocialSignIn(signInWithX)}
                                        disabled={isLoading}
                                        className="w-full py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-[10px] tracking-[0.12em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/30"
                                    >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                                            <path fill="currentColor" d="M18.244 2H21l-6.54 7.475L22 22h-5.828l-4.566-5.964L6.39 22H3.633l7-8.002L2 2h5.977l4.127 5.446L18.244 2Zm-1.021 18.285h1.527L7.147 3.624H5.507l11.716 16.661Z" />
                                        </svg>
                                        X
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Toggle */}
                        <div className="mt-2 pt-4 border-t border-white/10 text-center">
                            {mode === 'forgot-password' ? (
                                <p className="text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                                    Back to <button type="button" onClick={() => switchMode('signin')} className="ml-1 text-white hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 underline-offset-4">Sign In</button>
                                </p>
                            ) : (
                                <p className="text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                                    {mode === 'signin' ? "Don't have an account?" : "Already have an account?"}
                                    <button type="button" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                                        className="ml-1 text-white hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 underline-offset-4">
                                        {mode === 'signin' ? 'Sign Up' : 'Sign In'}
                                    </button>
                                </p>
                            )}
                        </div>

                        <p className="text-[9px] text-slate-600 text-center uppercase tracking-widest font-bold mt-2">
                            By continuing, you accept our Terms & Privacy Policy.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginModal;
