import { Activity, AlertTriangle, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const getActivityCopy = (type, t) => {
    const messages = {
        sign_in: [
            t('profile.securityActivity.signIn.title', {}, 'New sign-in'),
            t('profile.securityActivity.signIn.body', {}, 'A browser session signed in to your account.'),
        ],
        suspicious_sign_in: [
            t('profile.securityActivity.risk.title', {}, 'Sign-in reviewed'),
            t('profile.securityActivity.risk.body', {}, 'Aura evaluated a sign-in security signal.'),
        ],
        new_device_sign_in: [
            t('profile.securityActivity.newDevice.title', {}, 'New device signed in'),
            t('profile.securityActivity.newDevice.body', {}, 'A browser session signed in from a device we had not seen. Revoke any session you do not recognize.'),
        ],
        password_changed: [
            t('profile.securityActivity.password.title', {}, 'Password changed'),
            t('profile.securityActivity.password.body', {}, 'Your password recovery flow completed.'),
        ],
        passkey_added: [
            t('profile.securityActivity.passkeyAdded.title', {}, 'Passkey added'),
            t('profile.securityActivity.passkeyAdded.body', {}, 'A passkey was registered for account MFA.'),
        ],
        passkey_removed: [
            t('profile.securityActivity.passkeyRemoved.title', {}, 'Passkey removed'),
            t('profile.securityActivity.passkeyRemoved.body', {}, 'A registered passkey was removed.'),
        ],
        authenticator_enabled: [
            t('profile.securityActivity.totpAdded.title', {}, 'Authenticator enabled'),
            t('profile.securityActivity.totpAdded.body', {}, 'Authenticator-app MFA was enabled.'),
        ],
        authenticator_disabled: [
            t('profile.securityActivity.totpRemoved.title', {}, 'Authenticator disabled'),
            t('profile.securityActivity.totpRemoved.body', {}, 'Authenticator-app MFA was disabled.'),
        ],
        recovery_codes_changed: [
            t('profile.securityActivity.recovery.title', {}, 'Recovery codes refreshed'),
            t('profile.securityActivity.recovery.body', {}, 'A new set of backup recovery codes was created.'),
        ],
        recovery_code_used: [
            t('profile.securityActivity.recoveryUsed.title', {}, 'Recovery code used'),
            t('profile.securityActivity.recoveryUsed.body', {}, 'A backup recovery code completed an authentication step.'),
        ],
        session_revoked: [
            t('profile.securityActivity.session.title', {}, 'Session signed out'),
            t('profile.securityActivity.session.body', {}, 'One browser session was revoked.'),
        ],
        sessions_revoked: [
            t('profile.securityActivity.sessions.title', {}, 'Other sessions signed out'),
            t('profile.securityActivity.sessions.body', {}, 'All other browser sessions were revoked.'),
        ],
        global_logout: [
            t('profile.securityActivity.global.title', {}, 'Signed out everywhere'),
            t('profile.securityActivity.global.body', {}, 'Every active browser session was revoked.'),
        ],
        remembered_browser_revoked: [
            t('profile.securityActivity.device.title', {}, 'Remembered browser revoked'),
            t('profile.securityActivity.device.body', {}, 'One trusted credential or remembered browser was revoked.'),
        ],
        remembered_browsers_revoked: [
            t('profile.securityActivity.devices.title', {}, 'Other remembered browsers revoked'),
            t('profile.securityActivity.devices.body', {}, 'Other trusted credentials and remembered browsers were revoked.'),
        ],
    };
    return messages[type] || [
        t('profile.securityActivity.generic.title', {}, 'Security setting changed'),
        t('profile.securityActivity.generic.body', {}, 'A security-related account action completed.'),
    ];
};

const formatDate = (value, fallback) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
};

export default function SecurityActivityPanel({
    activity = [],
    retentionDays = 180,
    loading = false,
    loaded = false,
    error = null,
    hasMore = false,
    onRetry,
    onLoadMore,
}) {
    const t = useStableIcuMessages();
    const unknownDate = t('profile.securityActivity.unknownDate', {}, 'Unknown time');

    return (
        <section aria-labelledby="security-activity-heading" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 id="security-activity-heading" className="flex items-center gap-2 text-sm font-black text-white">
                        <Activity className="h-4 w-4 text-neo-cyan" aria-hidden="true" />
                        {t('profile.securityActivity.title', {}, 'Security activity')}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                        {t(
                            'profile.securityActivity.retention',
                            { days: retentionDays },
                            'Customer-safe security events are available for up to {days} days. Operational identifiers and raw logs are never shown.'
                        )}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={loading || !onRetry}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-black text-white disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {t('profile.securityActivity.refresh', {}, 'Refresh activity')}
                </button>
            </div>

            {error ? (
                <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-rose-300/25 bg-rose-400/10 p-3 text-xs text-rose-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {String(error?.message || t('profile.securityActivity.error', {}, 'Security activity could not be loaded.'))}
                </div>
            ) : null}

            {!loaded && loading ? (
                <div role="status" className="mt-4 h-24 animate-pulse rounded-xl bg-white/5 motion-reduce:animate-none">
                    <span className="sr-only">{t('profile.securityActivity.loading', {}, 'Loading security activity')}</span>
                </div>
            ) : null}

            {loaded && activity.length === 0 && !error ? (
                <div className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">
                    <ShieldAlert className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                    {t('profile.securityActivity.empty', {}, 'No customer-visible security events are available yet.')}
                </div>
            ) : null}

            {activity.length > 0 ? (
                <ol className="mt-4 space-y-3">
                    {activity.map((entry, index) => {
                        const [title, body] = getActivityCopy(entry.type, t);
                        return (
                            <li key={`${entry.type}-${entry.occurredAt}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                                <p className="font-black text-white">{title}</p>
                                <p className="mt-1 text-xs leading-5 text-slate-300">{body}</p>
                                <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                                    {formatDate(entry.occurredAt, unknownDate)}
                                </p>
                            </li>
                        );
                    })}
                </ol>
            ) : null}

            {hasMore ? (
                <button
                    type="button"
                    onClick={onLoadMore}
                    disabled={loading || !onLoadMore}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                    {loading
                        ? t('profile.securityActivity.loadingMore', {}, 'Loading more...')
                        : t('profile.securityActivity.loadMore', {}, 'Load more activity')}
                </button>
            ) : null}
        </section>
    );
}
