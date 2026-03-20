import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bell, Clock3, Lock, LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TogglePref } from './ProfileShared';

export default function SettingsSection({
    handlePasswordReset,
    passwordResetting,
    hasOtpReadyIdentity,
    trustHealthy,
    trustLoading,
    paymentMethodsSecured,
    paymentMethodCount,
    trustStatus,
    logout,
    memberSince,
}) {
    const [orderUpdates, setOrderUpdates] = useState(true);
    const [marketplaceUpdates, setMarketplaceUpdates] = useState(true);
    const [supportUpdates, setSupportUpdates] = useState(true);

    const lastCheckText = useMemo(() => {
        if (!trustStatus?.backend?.timestamp) return 'No recent check timestamp';
        return new Date(trustStatus.backend.timestamp).toLocaleString('en-IN');
    }, [trustStatus?.backend?.timestamp]);

    return (
        <div className="max-w-3xl space-y-6">
            <div className="premium-panel p-6">
                <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                    <Lock className="w-5 h-5 text-neo-cyan" />
                    Security
                </h3>
                <div className="space-y-4">
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="font-semibold text-white text-sm">Password</p>
                                <p className="text-xs text-slate-400 mt-1">Managed through Firebase Authentication with recovery by email.</p>
                            </div>
                            <button
                                onClick={handlePasswordReset}
                                disabled={passwordResetting}
                                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-60"
                            >
                                {passwordResetting ? 'Sending...' : 'Send Reset Link'}
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className={`rounded-[1.6rem] border p-4 ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">OTP posture</p>
                            <p className={`mt-2 text-lg font-black ${hasOtpReadyIdentity ? 'text-emerald-100' : 'text-amber-100'}`}>
                                {hasOtpReadyIdentity ? 'Ready' : 'Incomplete'}
                            </p>
                            <p className="mt-2 text-xs text-slate-300">
                                {hasOtpReadyIdentity
                                    ? 'Email and phone are ready for stronger account assurance.'
                                    : 'Add or correct a phone number to unlock stronger identity protection.'}
                            </p>
                        </div>

                        <div className={`rounded-[1.6rem] border p-4 ${paymentMethodsSecured ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Payment posture</p>
                            <p className={`mt-2 text-lg font-black ${paymentMethodsSecured ? 'text-emerald-100' : 'text-amber-100'}`}>
                                {paymentMethodsSecured ? 'Tokenized' : 'Review needed'}
                            </p>
                            <p className="mt-2 text-xs text-slate-300">
                                {paymentMethodCount} saved payment {paymentMethodCount === 1 ? 'method' : 'methods'} {paymentMethodsSecured ? 'with a default secured method active.' : 'and no trusted default method yet.'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="premium-panel p-6">
                <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-neo-cyan" />
                    Trust & Security Command Center
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <div className={`rounded-[1.6rem] border p-4 ${trustHealthy ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-black text-slate-300">Platform status</p>
                        <p className={`text-sm font-black mt-2 ${trustHealthy ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {trustLoading ? 'Checking...' : trustHealthy ? 'Healthy' : 'Degraded'}
                        </p>
                    </div>
                    <div className={`rounded-[1.6rem] border p-4 ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-black text-slate-300">Identity posture</p>
                        <p className={`text-sm font-black mt-2 ${hasOtpReadyIdentity ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {hasOtpReadyIdentity ? 'Fortified' : 'Needs attention'}
                        </p>
                    </div>
                    <div className={`rounded-[1.6rem] border p-4 ${paymentMethodsSecured ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-black text-slate-300">Payment safety</p>
                        <p className={`text-sm font-black mt-2 ${paymentMethodsSecured ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {paymentMethodsSecured ? 'Tokenized + default' : 'Review needed'}
                        </p>
                    </div>
                </div>

                <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <div className="flex flex-wrap items-center gap-2 text-slate-200 font-black">
                        <Clock3 className="w-4 h-4 text-neo-cyan" />
                        Last trust sweep
                    </div>
                    <p className="mt-2">{lastCheckText}</p>
                    <p className="mt-2 text-xs text-slate-500">
                        Member since {memberSince}. Backend status: {trustStatus?.backend?.status || 'unknown'} | DB: {trustStatus?.backend?.db || 'unknown'}
                    </p>
                </div>

                {!trustHealthy ? (
                    <div className="mt-4 rounded-[1.4rem] border border-amber-400/20 bg-amber-500/12 px-4 py-3 text-xs text-amber-100">
                        Some live trust checks are degraded. Core account actions still work, but use official support channels if behavior looks suspicious.
                    </div>
                ) : null}
            </div>

            <div className="premium-panel p-6">
                <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-neo-cyan" />
                    Notification posture
                </h3>
                <div className="space-y-3">
                    <TogglePref label="Order Updates" desc="Status changes, refund progress, and delivery actions." on={orderUpdates} setOn={setOrderUpdates} />
                    <TogglePref label="Marketplace" desc="Listing health, offers, and selling-side alerts." on={marketplaceUpdates} setOn={setMarketplaceUpdates} />
                    <TogglePref label="Support & Governance" desc="Appeals, admin actions, and durable support responses." on={supportUpdates} setOn={setSupportUpdates} />
                </div>
            </div>

            <div className="premium-panel p-6">
                <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-300" />
                    Safety controls
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                    <Link to="/security" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 text-center">
                        Open Security Policy
                    </Link>
                    <Link to="/privacy" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 text-center">
                        Open Privacy Policy
                    </Link>
                    <Link to="/contact" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 text-center">
                        Contact Support
                    </Link>
                    <button
                        onClick={logout}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm font-black text-rose-100 hover:bg-rose-500/18"
                    >
                        <LogOut className="w-4 h-4" />
                        Log Out
                    </button>
                </div>
            </div>
        </div>
    );
}
