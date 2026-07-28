import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Ban, RefreshCw, Trash2 } from 'lucide-react';
import { authApi } from '@/services/api';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { ACCOUNT_TELEMETRY_EVENTS, trackAccountEvent } from '@/services/accountTelemetry';

const createIdempotencyKey = (type) => `${type}-${
    typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}`;

const PrivacyAction = ({
    icon: Icon,
    title,
    description,
    children,
}) => (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <Icon className="h-5 w-5 text-[#d2a96c]" aria-hidden="true" />
        <h3 className="mt-4 text-lg font-black text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        <div className="mt-5">{children}</div>
    </section>
);

export default function PrivacyControlsSection({ firebaseUser }) {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const translateRef = useRef(t);
    const idempotencyKeysRef = useRef({});
    const [capabilities, setCapabilities] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [working, setWorking] = useState('');
    const [notice, setNotice] = useState('');
    const [deactivationConfirmation, setDeactivationConfirmation] = useState('');
    const [deletionConfirmation, setDeletionConfirmation] = useState('');
    const [request, setRequest] = useState(null);

    useEffect(() => {
        translateRef.current = t;
    }, [t]);

    const loadCapabilities = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setCapabilities(await authApi.getAccountPrivacyCapabilities({ firebaseUser }));
        } catch (loadError) {
            setError(loadError?.message || translateRef.current(
                'profile.privacy.loadError',
                {},
                'Privacy controls could not be loaded.'
            ));
        } finally {
            setLoading(false);
        }
    }, [firebaseUser]);

    useEffect(() => {
        void loadCapabilities();
    }, [loadCapabilities]);

    const runRequest = async (type, action) => {
        setWorking(type);
        setNotice('');
        setError('');
        try {
            const result = await action();
            delete idempotencyKeysRef.current[type];
            setRequest(result?.request || null);
            setNotice(translateRef.current(
                'profile.privacy.requestQueued',
                {},
                'Your privacy request was queued for controlled processing.'
            ));
            const eventName = {
                export: ACCOUNT_TELEMETRY_EVENTS.EXPORT_REQUESTED,
                deactivation: ACCOUNT_TELEMETRY_EVENTS.DEACTIVATION_INITIATED,
                deletion: ACCOUNT_TELEMETRY_EVENTS.DELETION_INITIATED,
            }[type];
            if (eventName) {
                trackAccountEvent(eventName);
            }
        } catch (requestError) {
            setError(requestError?.message || translateRef.current(
                'profile.privacy.requestError',
                {},
                'The privacy request could not be created.'
            ));
        } finally {
            setWorking('');
        }
    };

    const getRequestKey = (type) => {
        if (!idempotencyKeysRef.current[type]) {
            idempotencyKeysRef.current[type] = createIdempotencyKey(type);
        }
        return idempotencyKeysRef.current[type];
    };

    const cancelCurrentRequest = async () => {
        if (!request?.id || !['deactivation', 'deletion'].includes(request.type)) return;
        setWorking('cancel');
        setNotice('');
        setError('');
        try {
            const result = request.type === 'deletion'
                ? await authApi.cancelAccountDeletion({ requestId: request.id }, { firebaseUser })
                : await authApi.cancelAccountDeactivation({ requestId: request.id }, { firebaseUser });
            setRequest(result?.request || null);
            setNotice(translateRef.current(
                'profile.privacy.requestCancelled',
                {},
                'The account lifecycle request was cancelled.'
            ));
        } catch (cancelError) {
            setError(cancelError?.message || translateRef.current(
                'profile.privacy.cancelError',
                {},
                'The account lifecycle request could not be cancelled.'
            ));
        } finally {
            setWorking('');
        }
    };

    if (loading) {
        return <p role="status" className="premium-panel p-6 text-sm text-slate-300">{t('profile.privacy.loading', {}, 'Loading privacy controls...')}</p>;
    }

    if (error && !capabilities) {
        return (
            <div className="rounded-2xl border border-rose-300/20 bg-rose-950/20 p-6">
                <p role="alert" className="text-sm text-rose-100">{error}</p>
                <button type="button" onClick={loadCapabilities} className="mt-4 inline-flex min-h-11 items-center gap-2 font-black text-white">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t('profile.privacy.retry', {}, 'Try again')}
                </button>
            </div>
        );
    }

    const enabled = Boolean(capabilities?.enabled);

    return (
        <div className="grid gap-5">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6" aria-labelledby="privacy-controls-title">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#d2a96c]">
                    {t('profile.privacy.eyebrow', {}, 'Data and account lifecycle')}
                </p>
                <h2 id="privacy-controls-title" className="mt-1 text-2xl font-black text-white">
                    {t('profile.privacy.title', {}, 'Privacy controls')}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    {enabled
                        ? t('profile.privacy.enabledBody', {}, 'These actions require fresh authentication and run as auditable background jobs.')
                        : t('profile.privacy.blockedBody', {}, 'Export, deactivation, and deletion are unavailable until retention, legal-hold, jurisdiction, reactivation, and delivery policy is formally approved.')}
                </p>
                {!enabled ? (
                    <p role="status" className="mt-4 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm font-bold text-amber-100">
                        {t('profile.privacy.policyBlocked', {}, 'Production activation is policy-blocked. No destructive request can be submitted.')}
                    </p>
                ) : null}
                {notice ? <p role="status" className="mt-4 text-sm font-bold text-emerald-200">{notice}</p> : null}
                {error ? <p role="alert" className="mt-4 text-sm font-bold text-rose-200">{error}</p> : null}
                {request ? (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-slate-300">
                            {t(
                                'profile.privacy.currentRequest',
                                { type: request.type, status: request.status },
                                'Current request: {type} · {status}'
                            )}
                        </p>
                        {['deactivation', 'deletion'].includes(request.type)
                            && !['cancelled', 'completed'].includes(request.status) ? (
                                <button
                                    type="button"
                                    onClick={cancelCurrentRequest}
                                    disabled={Boolean(working)}
                                    className="min-h-11 rounded-lg border border-white/15 px-4 text-sm font-black text-white disabled:opacity-45"
                                >
                                    {t('profile.privacy.cancelAction', {}, 'Cancel request')}
                                </button>
                            ) : null}
                    </div>
                ) : null}
            </section>

            <div className="grid gap-4 xl:grid-cols-3">
                <PrivacyAction
                    icon={Archive}
                    title={t('profile.privacy.export.title', {}, 'Export account data')}
                    description={t('profile.privacy.export.body', {}, 'Create a minimized encrypted export with an expiring authenticated delivery step.')}
                >
                    <button
                        type="button"
                        disabled={!enabled || Boolean(working)}
                        onClick={() => runRequest('export', () => authApi.requestAccountExport({
                            idempotencyKey: getRequestKey('export'),
                        }, { firebaseUser }))}
                        className="min-h-11 w-full rounded-lg bg-[#d2a96c] px-4 text-sm font-black text-[#17231e] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {working === 'export'
                            ? t('profile.privacy.working', {}, 'Submitting...')
                            : t('profile.privacy.export.action', {}, 'Request export')}
                    </button>
                </PrivacyAction>

                <PrivacyAction
                    icon={Ban}
                    title={t('profile.privacy.deactivation.title', {}, 'Deactivate account')}
                    description={t('profile.privacy.deactivation.body', {}, 'Start a reversible policy-checked restriction after active-order and dispute checks.')}
                >
                    <label className="grid gap-2 text-xs font-bold text-slate-300">
                        <span>{t('profile.privacy.deactivation.confirm', {}, 'Type DEACTIVATE to continue')}</span>
                        <input
                            value={deactivationConfirmation}
                            onChange={(event) => setDeactivationConfirmation(event.target.value)}
                            disabled={!enabled || Boolean(working)}
                            autoComplete="off"
                            className="min-h-11 rounded-lg border border-white/15 bg-slate-950 px-3 text-sm text-white"
                        />
                    </label>
                    <button
                        type="button"
                        disabled={!enabled || Boolean(working) || deactivationConfirmation !== 'DEACTIVATE'}
                        onClick={() => runRequest('deactivation', () => authApi.requestAccountDeactivation({
                            confirmation: deactivationConfirmation,
                            idempotencyKey: getRequestKey('deactivation'),
                        }, { firebaseUser }))}
                        className="mt-3 min-h-11 w-full rounded-lg border border-amber-200/30 px-4 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {t('profile.privacy.deactivation.action', {}, 'Begin deactivation')}
                    </button>
                </PrivacyAction>

                <PrivacyAction
                    icon={Trash2}
                    title={t('profile.privacy.deletion.title', {}, 'Delete account')}
                    description={t('profile.privacy.deletion.body', {}, 'Begin a grace-period job with legal-hold checks, cancellation, cleanup, recovery, and completion evidence.')}
                >
                    <label className="grid gap-2 text-xs font-bold text-slate-300">
                        <span>{t('profile.privacy.deletion.confirm', {}, 'Type DELETE MY ACCOUNT to continue')}</span>
                        <input
                            value={deletionConfirmation}
                            onChange={(event) => setDeletionConfirmation(event.target.value)}
                            disabled={!enabled || Boolean(working)}
                            autoComplete="off"
                            className="min-h-11 rounded-lg border border-white/15 bg-slate-950 px-3 text-sm text-white"
                        />
                    </label>
                    <button
                        type="button"
                        disabled={!enabled || Boolean(working) || deletionConfirmation !== 'DELETE MY ACCOUNT'}
                        onClick={() => runRequest('deletion', () => authApi.requestAccountDeletion({
                            confirmation: deletionConfirmation,
                            idempotencyKey: getRequestKey('deletion'),
                        }, { firebaseUser }))}
                        className="mt-3 min-h-11 w-full rounded-lg border border-rose-200/30 px-4 text-sm font-black text-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {t('profile.privacy.deletion.action', {}, 'Begin deletion request')}
                    </button>
                </PrivacyAction>
            </div>
        </div>
    );
}
