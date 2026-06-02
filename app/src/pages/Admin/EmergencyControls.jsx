import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, FileText, Power, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import { AuthContext } from '@/context/AuthContext';
import { emergencyApi } from '@/services/api';
import { FormattedMessage, useIntl } from 'react-intl';

const CONFIRMATION_KEYS = new Set(['GLOBAL_MAINTENANCE', 'READ_ONLY_MODE', 'FORCE_LOGOUT_ALL_USERS']);
const DEFAULT_MESSAGES = {
    GLOBAL_MAINTENANCE: 'We are temporarily performing emergency maintenance. Please try again later.',
    READ_ONLY_MODE: 'The system is temporarily in read-only mode.',
    DISABLE_PAYMENT: 'Payments are temporarily unavailable. Please try again later.',
    DISABLE_CHECKOUT: 'Checkout is temporarily unavailable. You can continue browsing products.',
    DISABLE_OTP_SEND: 'Verification is temporarily unavailable. Please try again later.',
};

const toLocalInputValue = (date = new Date(Date.now() + 60 * 60 * 1000)) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return local.toISOString().slice(0, 16);
};

const fromLocalInputValue = (value = '') => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};

const EmergencyControls = () => {
    const intl = useIntl();
    const { dbUser, roles } = useContext(AuthContext) || {};
    const [flags, setFlags] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [selectedKey, setSelectedKey] = useState('DISABLE_PAYMENT');
    const [reason, setReason] = useState('');
    const [userMessage, setUserMessage] = useState('');
    const [expiresAt, setExpiresAt] = useState(() => toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
    const [confirmationPhrase, setConfirmationPhrase] = useState('');
    const [noExpiryConfirmed, setNoExpiryConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);

    const adminRoles = roles?.adminRoles || dbUser?.adminRoles || [];
    const hasEmergencyRole = Boolean(dbUser?.isAdmin || roles?.isAdmin)
        && adminRoles.some((role) => role === 'SUPER_ADMIN' || role === 'SECURITY_ADMIN');

    const activeFlags = useMemo(() => flags.filter((flag) => flag.active), [flags]);
    const selectedFlag = useMemo(
        () => flags.find((flag) => flag.key === selectedKey) || null,
        [flags, selectedKey]
    );

    const loadControls = useCallback(async () => {
        setLoading(true);
        try {
            const [controlsPayload, auditPayload] = await Promise.all([
                emergencyApi.listAdminControls(),
                emergencyApi.listAudit({ limit: 20 }),
            ]);
            const nextFlags = Array.isArray(controlsPayload?.flags) ? controlsPayload.flags : [];
            setFlags(nextFlags);
            setAuditLogs(Array.isArray(auditPayload?.logs) ? auditPayload.logs : []);
            if (!nextFlags.some((flag) => flag.key === selectedKey) && nextFlags[0]?.key) {
                setSelectedKey(nextFlags[0].key);
            }
        } catch (error) {
            toast.error(error?.message || 'Unable to load emergency controls');
        } finally {
            setLoading(false);
        }
    }, [selectedKey]);

    useEffect(() => {
        void loadControls();
    }, [loadControls]);

    useEffect(() => {
        setUserMessage(DEFAULT_MESSAGES[selectedKey] || selectedFlag?.userMessage || '');
        setConfirmationPhrase('');
        setNoExpiryConfirmed(false);
    }, [selectedFlag?.userMessage, selectedKey]);

    const runAction = async (action) => {
        if (!selectedKey) return;
        setBusy(true);
        try {
            if (action === 'activate') {
                await emergencyApi.activate(selectedKey, {
                    reason,
                    userMessage,
                    expiresAt: noExpiryConfirmed ? null : fromLocalInputValue(expiresAt),
                    noExpiryConfirmed,
                    confirmationPhrase,
                });
                toast.success(intl.formatMessage(
                    { id: 'admin.feedback.activated', defaultMessage: '{selectedKey} activated' },
                    { selectedKey },
                ));
            } else if (action === 'deactivate') {
                await emergencyApi.deactivate(selectedKey, { reason, confirmationPhrase });
                toast.success(intl.formatMessage(
                    { id: 'admin.feedback.deactivated', defaultMessage: '{selectedKey} deactivated' },
                    { selectedKey },
                ));
            } else if (action === 'extend') {
                await emergencyApi.extend(selectedKey, {
                    reason,
                    expiresAt: fromLocalInputValue(expiresAt),
                    confirmationPhrase,
                });
                toast.success(intl.formatMessage(
                    { id: 'admin.feedback.expiry.extended', defaultMessage: '{selectedKey} expiry extended' },
                    { selectedKey },
                ));
            } else if (action === 'message') {
                await emergencyApi.updateMessage(selectedKey, { reason, userMessage });
                toast.success(intl.formatMessage(
                    { id: 'admin.feedback.message.updated', defaultMessage: '{selectedKey} message updated' },
                    { selectedKey },
                ));
            }
            setReason('');
            await loadControls();
        } catch (error) {
            toast.error(error?.message || 'Emergency control action failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AdminPremiumShell
            eyebrow="Emergency controls"
            title={<FormattedMessage id="admin.accessibility.emergency.control.center" defaultMessage="Emergency Control Center" />}
            description={<FormattedMessage id="checkout.jsx.prop.description.backend.enforced.safety.flags.for.maintenance.read" defaultMessage="Backend-enforced safety flags for maintenance, read-only protection, checkout, payments, auth, admin mutations, and assistant shutdowns." />}
            stats={[
                <AdminHeroStat key="active" label={<FormattedMessage id="admin.jsx.prop.label.active.flags" defaultMessage="Active flags" />} value={activeFlags.length} icon={<ShieldAlert className="h-5 w-5" />} />,
                <AdminHeroStat key="critical" label={<FormattedMessage id="admin.jsx.prop.label.critical.active" defaultMessage="Critical active" />} value={activeFlags.filter((flag) => flag.severity === 'critical').length} icon={<AlertTriangle className="h-5 w-5" />} />,
                <AdminHeroStat key="expired" label={<FormattedMessage id="admin.jsx.prop.label.expired.visible" defaultMessage="Expired visible" />} value={flags.filter((flag) => flag.expired).length} icon={<Clock className="h-5 w-5" />} />,
                <AdminHeroStat key="audit" label={<FormattedMessage id="admin.jsx.prop.label.audit.rows" defaultMessage="Audit rows" />} value={auditLogs.length} icon={<FileText className="h-5 w-5" />} />,
            ]}
        >
            {!hasEmergencyRole ? (
                <AdminPremiumPanel>
                    <div className="flex items-start gap-3 text-amber-200">
                        <ShieldCheck className="mt-1 h-5 w-5" />
                        <div>
                            <h2 className="text-xl font-black text-white"><FormattedMessage id="admin.jsx.text.emergency.admin.role.required" defaultMessage="Emergency admin role required" /></h2>
                            <p className="mt-2 text-sm text-slate-300"><FormattedMessage id="auth.jsx.text.backend.authorization.requires.super.admin.or.security" defaultMessage="Backend authorization requires SUPER_ADMIN or SECURITY_ADMIN. Bootstrap emails are audited server-side only." /></p>
                        </div>
                    </div>
                </AdminPremiumPanel>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-3">
                <AdminPremiumPanel className="space-y-5 xl:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="premium-kicker"><FormattedMessage id="admin.jsx.text.active.emergency.flags" defaultMessage="Active emergency flags" /></p>
                            <h2 className="mt-2 text-2xl font-black text-white"><FormattedMessage id="admin.jsx.text.current.safety.posture" defaultMessage="Current safety posture" /></h2>
                        </div>
                        <button
                            type="button"
                            onClick={loadControls}
                            className="admin-premium-button"
                            disabled={loading || busy}
                        ><FormattedMessage id="admin.jsx.text.refresh" defaultMessage="Refresh" /></button>
                    </div>

                    <div className="grid gap-3">
                        {(activeFlags.length ? activeFlags : flags.filter((flag) => flag.expired).slice(0, 4)).map((flag) => (
                            <AdminPremiumSubpanel key={flag.key} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-black text-white">{flag.key}</span>
                                        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-300">{flag.severity}</span>
                                        <span className="rounded-full border border-cyan-300/20 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-200">{flag.scope}</span>
                                        {flag.expired ? <span className="rounded-full border border-amber-300/25 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-200"><FormattedMessage id="admin.jsx.text.expired" defaultMessage="Expired" /></span> : null}
                                    </div>
                                    <p className="mt-2 text-sm text-slate-300">{flag.userMessage}</p>
                                    <p className="mt-1 text-xs text-slate-500"><FormattedMessage id="admin.jsx.text.activated.by" defaultMessage="Activated by" />{' '}{flag.activatedByEmail || 'system'}{' '}<FormattedMessage id="admin.jsx.text.expires" defaultMessage="| Expires" />{' '}{flag.expiresAt || <FormattedMessage id="admin.jsx.expression.no.expiry" defaultMessage="no expiry" />}</p>
                                </div>
                                <button type="button" className="admin-premium-button" onClick={() => setSelectedKey(flag.key)}><FormattedMessage id="admin.jsx.text.manage" defaultMessage="Manage" /></button>
                            </AdminPremiumSubpanel>
                        ))}
                        {!activeFlags.length && !flags.some((flag) => flag.expired) ? (
                            <AdminPremiumSubpanel className="text-sm text-slate-300"><FormattedMessage id="admin.jsx.text.no.emergency.flags.are.active" defaultMessage="No emergency flags are active." /></AdminPremiumSubpanel>
                        ) : null}
                    </div>
                </AdminPremiumPanel>

                <AdminPremiumPanel className="space-y-4">
                    <p className="premium-kicker"><FormattedMessage id="admin.jsx.text.mutate.flag" defaultMessage="Mutate flag" /></p>
                    <label className="grid gap-2 text-sm font-semibold text-slate-200"><FormattedMessage id="admin.jsx.text.flag" defaultMessage="Flag" /><select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="checkout-premium-input">
                            {flags.map((flag) => (
                                <option key={flag.key} value={flag.key}>{flag.key}</option>
                            ))}
                        </select>
                    </label>
                    <label className="grid gap-2 text-sm font-semibold text-slate-200"><FormattedMessage id="admin.jsx.text.user.message" defaultMessage="User message" /><textarea value={userMessage} onChange={(event) => setUserMessage(event.target.value)} className="checkout-premium-input min-h-24" />
                    </label>
                    <label className="grid gap-2 text-sm font-semibold text-slate-200"><FormattedMessage id="admin.jsx.text.internal.reason" defaultMessage="Internal reason" /><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="checkout-premium-input min-h-24" />
                    </label>
                    {CONFIRMATION_KEYS.has(selectedKey) ? (
                        <label className="grid gap-2 text-sm font-semibold text-slate-200"><FormattedMessage id="admin.jsx.text.confirmation.phrase" defaultMessage="Confirmation phrase" /><input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} className="checkout-premium-input" placeholder={intl.formatMessage({ id: 'admin.jsx.prop.placeholder.i.understand', defaultMessage: 'I UNDERSTAND' })} />
                        </label>
                    ) : null}
                    <label className="grid gap-2 text-sm font-semibold text-slate-200"><FormattedMessage id="admin.jsx.text.expires.at" defaultMessage="Expires at" /><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="checkout-premium-input" disabled={noExpiryConfirmed} />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        <input type="checkbox" checked={noExpiryConfirmed} onChange={(event) => setNoExpiryConfirmed(event.target.checked)} /><FormattedMessage id="admin.jsx.text.confirm.no.expiry" defaultMessage="Confirm no expiry" /></label>
                    <div className="grid gap-2">
                        <button type="button" onClick={() => runAction('activate')} disabled={busy} className="admin-premium-button admin-premium-button-danger">
                            <Power className="h-4 w-4" /><FormattedMessage id="admin.jsx.text.activate" defaultMessage="Activate" /></button>
                        <button type="button" onClick={() => runAction('deactivate')} disabled={busy} className="admin-premium-button"><FormattedMessage id="admin.jsx.text.deactivate" defaultMessage="Deactivate" /></button>
                        <button type="button" onClick={() => runAction('extend')} disabled={busy || noExpiryConfirmed} className="admin-premium-button"><FormattedMessage id="admin.jsx.text.extend.expiry" defaultMessage="Extend expiry" /></button>
                        <button type="button" onClick={() => runAction('message')} disabled={busy} className="admin-premium-button"><FormattedMessage id="admin.jsx.text.update.message" defaultMessage="Update message" /></button>
                    </div>
                </AdminPremiumPanel>
            </div>

            <AdminPremiumPanel className="space-y-4">
                <p className="premium-kicker"><FormattedMessage id="admin.jsx.text.audit.trail" defaultMessage="Audit trail" /></p>
                <div className="grid gap-3">
                    {auditLogs.map((log) => (
                        <AdminPremiumSubpanel key={log._id || log.id} className="grid gap-1 text-sm text-slate-300">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-black text-white">{log.action}</span>
                                <span>{log.flagKey}</span>
                                <span className="text-xs text-slate-500">{log.createdAt}</span>
                                <span className="text-xs text-slate-500">request {log.requestId || <FormattedMessage id="admin.jsx.expression.n.a" defaultMessage="n/a" />}</span>
                            </div>
                            <p>{log.reason || <FormattedMessage id="admin.jsx.expression.no.reason.recorded" defaultMessage="No reason recorded" />}</p>
                            <p className="text-xs text-slate-500">{log.performedByEmail || <FormattedMessage id="admin.jsx.expression.unknown.actor" defaultMessage="unknown actor" />}</p>
                        </AdminPremiumSubpanel>
                    ))}
                    {!auditLogs.length ? <AdminPremiumSubpanel className="text-sm text-slate-400"><FormattedMessage id="admin.jsx.text.no.audit.entries.found" defaultMessage="No audit entries found." /></AdminPremiumSubpanel> : null}
                </div>
            </AdminPremiumPanel>
        </AdminPremiumShell>
    );
};

export default EmergencyControls;
