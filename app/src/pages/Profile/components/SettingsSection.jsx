import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, Copy, Download, KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarket } from '@/context/MarketContext';
import { TogglePref } from './ProfileShared';

export default function SettingsSection({
    handleSecureRecovery,
    recoveryLaunching,
    canStartSecureRecovery,
    hasOtpReadyIdentity,
    trustHealthy,
    trustLoading,
    paymentMethodsSecured,
    paymentMethodCount,
    trustStatus,
    logout,
    memberSince,
    hasPasskey = false,
    shouldEnrollRecoveryCodes = false,
    passkeyRecoveryReady = true,
    recoveryCodesActiveCount = 0,
    recoveryCodes = [],
    recoveryCodesGenerating = false,
    handleGenerateRecoveryCodes,
    handleCopyRecoveryCodes,
    handleDownloadRecoveryCodes,
    handleClearVisibleRecoveryCodes,
}) {
    const { t } = useMarket();
    const [orderUpdates, setOrderUpdates] = useState(true);
    const [marketplaceUpdates, setMarketplaceUpdates] = useState(true);
    const [supportUpdates, setSupportUpdates] = useState(true);
    const hasVisibleRecoveryCodes = recoveryCodes.length > 0;
    const recoveryReady = hasPasskey && passkeyRecoveryReady && !shouldEnrollRecoveryCodes;

    const lastCheckText = useMemo(() => {
        if (!trustStatus?.backend?.timestamp) return t('profile.settings.trust.noRecent', {}, 'No recent check timestamp');
        return new Date(trustStatus.backend.timestamp).toLocaleString('en-IN');
    }, [t, trustStatus?.backend?.timestamp]);

    return (
        <div className="max-w-3xl space-y-6">
            <div className="premium-panel p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-white">
                    <Lock className="h-5 w-5 text-neo-cyan" />
                    {t('profile.settings.security.title', {}, 'Security')}
                </h3>
                <div className="space-y-4">
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-white">{t('profile.settings.security.password', {}, 'Password')}</p>
                                <p className="mt-1 text-xs text-slate-400">{t('profile.settings.security.passwordBody', {}, 'Password recovery now follows the same email + phone OTP flow as sign-in.')}</p>
                                {!canStartSecureRecovery ? (
                                    <p className="mt-2 text-[11px] text-amber-200">
                                        {t('profile.settings.security.recoveryHint', {}, 'Add a verified email and registered phone to unlock secure recovery from this panel.')}
                                    </p>
                                ) : null}
                            </div>
                            <button
                                onClick={handleSecureRecovery}
                                disabled={recoveryLaunching || !canStartSecureRecovery}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-60"
                            >
                                {recoveryLaunching
                                    ? t('profile.settings.security.opening', {}, 'Opening...')
                                    : t('profile.settings.security.openRecovery', {}, 'Open Secure Recovery')}
                            </button>
                        </div>
                    </div>

                    <div className={`rounded-[1.6rem] border p-4 ${recoveryReady ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${recoveryReady ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-amber-300/25 bg-amber-400/10 text-amber-100'}`}>
                                        {recoveryReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                                        {recoveryReady
                                            ? t('profile.settings.security.recoveryCodesReady', {}, 'Recovery ready')
                                            : t('profile.settings.security.recoveryCodesAction', {}, 'Recovery action')}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-300">
                                        {t(
                                            'profile.settings.security.recoveryCodesCount',
                                            { count: recoveryCodesActiveCount },
                                            `${recoveryCodesActiveCount} active backup codes`,
                                        )}
                                    </span>
                                </div>
                                <p className="mt-3 flex items-center gap-2 text-sm font-black text-white">
                                    <ShieldCheck className="h-4 w-4 text-neo-cyan" />
                                    {t('profile.settings.security.recoveryCodesTitle', {}, 'Passkey backup recovery codes')}
                                </p>
                                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300">
                                    {hasPasskey
                                        ? t('profile.settings.security.recoveryCodesBody', {}, 'Generate one-time backup codes so a passkey account has a recovery path that still stays server-gated and single-use.')
                                        : t('profile.settings.security.recoveryCodesPasskeyFirst', {}, 'Add a passkey first. Backup recovery codes are only available after the account has hardware-backed authentication.')}
                                </p>
                                {shouldEnrollRecoveryCodes ? (
                                    <p className="mt-2 text-[11px] font-semibold text-amber-100">
                                        {t('profile.settings.security.recoveryCodesEnrollHint', {}, 'This account has passkey protection but no backup codes yet. Generate them after a fresh passkey checkpoint.')}
                                    </p>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                onClick={handleGenerateRecoveryCodes}
                                disabled={recoveryCodesGenerating || !hasPasskey || !handleGenerateRecoveryCodes}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <KeyRound className="h-4 w-4" />
                                {recoveryCodesGenerating
                                    ? t('profile.settings.security.recoveryCodesGenerating', {}, 'Generating...')
                                    : recoveryCodesActiveCount > 0
                                        ? t('profile.settings.security.recoveryCodesRegenerate', {}, 'Regenerate codes')
                                        : t('profile.settings.security.recoveryCodesGenerate', {}, 'Generate codes')}
                            </button>
                        </div>

                        {hasVisibleRecoveryCodes ? (
                            <div className="mt-4 rounded-[1.4rem] border border-cyan-300/20 bg-slate-950/45 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
                                            {t('profile.settings.security.recoveryCodesShownOnce', {}, 'Shown once')}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-400">
                                            {t('profile.settings.security.recoveryCodesShownOnceBody', {}, 'These codes are not stored in readable form after this moment. Each one works only once.')}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={handleCopyRecoveryCodes}
                                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white hover:bg-white/10"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                            {t('profile.settings.security.recoveryCodesCopy', {}, 'Copy')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDownloadRecoveryCodes}
                                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white hover:bg-white/10"
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                            {t('profile.settings.security.recoveryCodesDownload', {}, 'Download .txt')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleClearVisibleRecoveryCodes}
                                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/10"
                                        >
                                            {t('profile.settings.security.recoveryCodesHide', {}, 'Hide')}
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                    {recoveryCodes.map((code) => (
                                        <code key={code} className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-center text-sm font-black tracking-[0.18em] text-cyan-50">
                                            {code}
                                        </code>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className={`rounded-[1.6rem] border p-4 ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{t('profile.settings.security.otpLabel', {}, 'OTP posture')}</p>
                            <p className={`mt-2 text-lg font-black ${hasOtpReadyIdentity ? 'text-emerald-100' : 'text-amber-100'}`}>
                                {hasOtpReadyIdentity ? t('profile.settings.security.ready', {}, 'Ready') : t('profile.settings.security.incomplete', {}, 'Incomplete')}
                            </p>
                            <p className="mt-2 text-xs text-slate-300">
                                {hasOtpReadyIdentity
                                    ? t('profile.settings.security.readyBody', {}, 'Email and phone are ready for stronger account assurance.')
                                    : t('profile.settings.security.incompleteBody', {}, 'Add or correct a phone number to unlock stronger identity protection.')}
                            </p>
                        </div>

                        <div className={`rounded-[1.6rem] border p-4 ${paymentMethodsSecured ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{t('profile.settings.security.paymentLabel', {}, 'Payment posture')}</p>
                            <p className={`mt-2 text-lg font-black ${paymentMethodsSecured ? 'text-emerald-100' : 'text-amber-100'}`}>
                                {paymentMethodsSecured ? t('profile.settings.security.tokenized', {}, 'Tokenized') : t('profile.settings.security.reviewNeeded', {}, 'Review needed')}
                            </p>
                            <p className="mt-2 text-xs text-slate-300">
                                {paymentMethodsSecured
                                    ? t('profile.settings.security.paymentSecuredBody', { count: paymentMethodCount }, `${paymentMethodCount} saved payment methods with a default secured method active.`)
                                    : t('profile.settings.security.paymentReviewBody', { count: paymentMethodCount }, `${paymentMethodCount} saved payment methods and no trusted default method yet.`)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="premium-panel p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-white">
                    <Activity className="h-5 w-5 text-neo-cyan" />
                    {t('profile.settings.trust.title', {}, 'Trust & Security Command Center')}
                </h3>

                <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className={`rounded-[1.6rem] border p-4 ${trustHealthy ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">{t('profile.settings.trust.platformStatus', {}, 'Platform status')}</p>
                        <p className={`mt-2 text-sm font-black ${trustHealthy ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {trustLoading
                                ? t('profile.settings.trust.checking', {}, 'Checking...')
                                : trustHealthy
                                    ? t('profile.settings.trust.healthy', {}, 'Healthy')
                                    : t('profile.settings.trust.degraded', {}, 'Degraded')}
                        </p>
                    </div>
                    <div className={`rounded-[1.6rem] border p-4 ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">{t('profile.settings.trust.identityLabel', {}, 'Identity posture')}</p>
                        <p className={`mt-2 text-sm font-black ${hasOtpReadyIdentity ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {hasOtpReadyIdentity ? t('profile.settings.trust.fortified', {}, 'Fortified') : t('profile.settings.trust.needsAttention', {}, 'Needs attention')}
                        </p>
                    </div>
                    <div className={`rounded-[1.6rem] border p-4 ${paymentMethodsSecured ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-amber-400/20 bg-amber-500/12'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">{t('profile.settings.trust.paymentSafety', {}, 'Payment safety')}</p>
                        <p className={`mt-2 text-sm font-black ${paymentMethodsSecured ? 'text-emerald-100' : 'text-amber-100'}`}>
                            {paymentMethodsSecured ? t('profile.settings.trust.tokenizedDefault', {}, 'Tokenized + default') : t('profile.settings.trust.reviewNeeded', {}, 'Review needed')}
                        </p>
                    </div>
                </div>

                <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <div className="flex flex-wrap items-center gap-2 font-black text-slate-200">
                        <Clock3 className="h-4 w-4 text-neo-cyan" />
                        {t('profile.settings.trust.lastSweep', {}, 'Last trust sweep')}
                    </div>
                    <p className="mt-2">{lastCheckText}</p>
                    <p className="mt-2 text-xs text-slate-500">
                        {t(
                            'profile.settings.trust.meta',
                            {
                                memberSince,
                                backend: trustStatus?.backend?.status || t('profile.settings.trust.unknown', {}, 'unknown'),
                                db: trustStatus?.backend?.db || t('profile.settings.trust.unknown', {}, 'unknown'),
                            },
                            `Member since ${memberSince}. Backend status: ${trustStatus?.backend?.status || 'unknown'} | DB: ${trustStatus?.backend?.db || 'unknown'}`,
                        )}
                    </p>
                </div>

                {!trustHealthy ? (
                    <div className="mt-4 rounded-[1.4rem] border border-amber-400/20 bg-amber-500/12 px-4 py-3 text-xs text-amber-100">
                        {t('profile.settings.trust.warning', {}, 'Some live trust checks are degraded. Core account actions still work, but use official support channels if behavior looks suspicious.')}
                    </div>
                ) : null}
            </div>

            <div className="premium-panel p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-white">
                    <Bell className="h-5 w-5 text-neo-cyan" />
                    {t('profile.settings.notifications.title', {}, 'Notification posture')}
                </h3>
                <div className="space-y-3">
                    <TogglePref
                        label={t('profile.settings.notifications.orders.label', {}, 'Order Updates')}
                        desc={t('profile.settings.notifications.orders.desc', {}, 'Status changes, refund progress, and delivery actions.')}
                        on={orderUpdates}
                        setOn={setOrderUpdates}
                    />
                    <TogglePref
                        label={t('profile.settings.notifications.marketplace.label', {}, 'Marketplace')}
                        desc={t('profile.settings.notifications.marketplace.desc', {}, 'Listing health, offers, and selling-side alerts.')}
                        on={marketplaceUpdates}
                        setOn={setMarketplaceUpdates}
                    />
                    <TogglePref
                        label={t('profile.settings.notifications.support.label', {}, 'Support & Governance')}
                        desc={t('profile.settings.notifications.support.desc', {}, 'Appeals, admin actions, and durable support responses.')}
                        on={supportUpdates}
                        setOn={setSupportUpdates}
                    />
                </div>
            </div>

            <div className="premium-panel p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-white">
                    <AlertTriangle className="h-5 w-5 text-rose-300" />
                    {t('profile.settings.safety.title', {}, 'Safety controls')}
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                    <Link to="/security" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-bold text-white hover:bg-white/10">
                        {t('profile.settings.safety.securityPolicy', {}, 'Open Security Policy')}
                    </Link>
                    <Link to="/privacy" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-bold text-white hover:bg-white/10">
                        {t('profile.settings.safety.privacyPolicy', {}, 'Open Privacy Policy')}
                    </Link>
                    <Link to="/contact" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-bold text-white hover:bg-white/10">
                        {t('profile.settings.safety.contactSupport', {}, 'Contact Support')}
                    </Link>
                    <button
                        onClick={logout}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm font-black text-rose-100 hover:bg-rose-500/18"
                    >
                        <LogOut className="h-4 w-4" />
                        {t('profile.settings.safety.logout', {}, 'Log Out')}
                    </button>
                </div>
            </div>
        </div>
    );
}
