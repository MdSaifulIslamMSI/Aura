import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bell, Clock3, Lock, LogOut } from 'lucide-react';
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
}) {
    const { t } = useMarket();
    const [orderUpdates, setOrderUpdates] = useState(true);
    const [marketplaceUpdates, setMarketplaceUpdates] = useState(true);
    const [supportUpdates, setSupportUpdates] = useState(true);

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
