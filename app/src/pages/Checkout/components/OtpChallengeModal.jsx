import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * OtpChallengeModal
 *
 * A secure, controlled in-page OTP input modal for payment challenge verification.
 * Replaces the insecure window.prompt() which was interceptable by extensions and
 * phishing overlays. Renders a glassmorphic 6-digit pin input with auto-focus,
 * paste support, and keyboard navigation.
 *
 * @param {boolean}  open     – Whether modal is visible
 * @param {boolean}  loading  – Show spinner while verifying
 * @param {string}   error    – Error message to display
 * @param {Function} onSubmit – Called with the OTP string when user submits
 * @param {Function} onClose  – Called when user dismisses the modal
 */
const OTP_LENGTH = 6;

const OtpChallengeModal = ({ open, loading = false, error = '', onSubmit, onClose }) => {
    const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
    const inputRefs = useRef([]);

    // Reset digits when modal opens
    useEffect(() => {
        if (open) {
            setDigits(Array(OTP_LENGTH).fill(''));
            // Auto-focus first input on next tick
            setTimeout(() => inputRefs.current[0]?.focus(), 50);
        }
    }, [open]);

    // Keyboard trap: close on Escape
    useEffect(() => {
        if (!open) return;
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    const handleDigitChange = (index, value) => {
        // Accept only digits
        const cleaned = value.replace(/\D/g, '').slice(-1);
        const next = [...digits];
        next[index] = cleaned;
        setDigits(next);

        // Auto-advance to next field
        if (cleaned && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace') {
            if (digits[index]) {
                const next = [...digits];
                next[index] = '';
                setDigits(next);
            } else if (index > 0) {
                inputRefs.current[index - 1]?.focus();
            }
        }
        if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
        if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
        if (e.key === 'Enter') handleSubmit();
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
        if (!pasted) return;
        const next = Array(OTP_LENGTH).fill('');
        pasted.split('').forEach((char, i) => { next[i] = char; });
        setDigits(next);
        // Focus the next empty slot or the last one
        const nextEmpty = next.findIndex((d) => !d);
        const focusIndex = nextEmpty === -1 ? OTP_LENGTH - 1 : nextEmpty;
        inputRefs.current[focusIndex]?.focus();
    };

    const handleSubmit = () => {
        const otp = digits.join('');
        if (otp.length !== OTP_LENGTH) return;
        onSubmit?.(otp);
    };

    const otpFilled = digits.every(Boolean);

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[90] bg-zinc-950/70 backdrop-blur-sm"
                onClick={onClose}
                aria-label="Close OTP dialog"
                role="button"
                tabIndex={-1}
                onKeyDown={(e) => e.key === 'Enter' && onClose?.()}
            />

            {/* Modal */}
            <dialog
                open
                className="fixed left-1/2 top-1/2 z-[95] -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-transparent border-none p-0 m-0"
                aria-labelledby="otp-modal-title"
                aria-modal="true"
            >
                <div className="relative w-full rounded-2xl border border-white/15 bg-[#07131a] shadow-[0_28px_90px_rgba(2,8,23,0.8)] ring-1 ring-cyan-400/10 p-6">
                    {/* Close button */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                        aria-label="Close"
                        disabled={loading}
                    >
                        <X className="w-4 h-4" />
                    </button>

                    {/* Header */}
                    <div className="flex flex-col items-center text-center gap-3 mb-6">
                        <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-300/20 flex items-center justify-center">
                            <ShieldCheck className="w-6 h-6 text-neo-cyan" />
                        </div>
                        <div>
                            <h2
                                id="otp-modal-title"
                                className="text-base font-black text-white tracking-tight"
                            >
                                Payment Challenge
                            </h2>
                            <p className="mt-1 text-sm text-slate-400">
                                Enter the 6-digit OTP sent to your registered contact.
                            </p>
                        </div>
                    </div>

                    {/* OTP Digit Inputs */}
                    <div
                        className="flex items-center justify-center gap-2 mb-4"
                        onPaste={handlePaste}
                    >
                        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                            <input
                                key={i}
                                ref={(el) => { inputRefs.current[i] = el; }}
                                id={`otp-digit-${i}`}
                                type="text"
                                inputMode="numeric"
                                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                                maxLength={1}
                                value={digits[i]}
                                disabled={loading}
                                onChange={(e) => handleDigitChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                className={cn(
                                    'w-11 h-13 rounded-xl border text-center text-xl font-black text-white',
                                    'bg-white/[0.05] outline-none transition-all duration-200',
                                    'focus:border-neo-cyan focus:bg-white/[0.09] focus:shadow-[0_0_10px_rgba(6,182,212,0.3)]',
                                    digits[i] ? 'border-white/25' : 'border-white/10',
                                    loading && 'opacity-50 cursor-not-allowed'
                                )}
                                aria-label={`OTP digit ${i + 1}`}
                            />
                        ))}
                    </div>

                    {/* Error */}
                    {error && (
                        <p className="mb-3 text-center text-sm text-red-400 font-semibold">
                            {error}
                        </p>
                    )}

                    {/* Submit */}
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!otpFilled || loading}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all',
                            otpFilled && !loading
                                ? 'bg-gradient-to-r from-neo-cyan to-neo-emerald text-white hover:-translate-y-0.5 hover:shadow-[0_0_18px_rgba(6,182,212,0.35)]'
                                : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
                        )}
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Verifying...
                            </>
                        ) : (
                            'Verify OTP'
                        )}
                    </button>

                    <p className="mt-3 text-center text-xs text-slate-500">
                        Didn&apos;t receive it?{' '}
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-neo-cyan hover:underline"
                            disabled={loading}
                        >
                            Cancel and retry
                        </button>
                    </p>
                </div>
            </dialog>
        </>
    );
};

export default OtpChallengeModal;
