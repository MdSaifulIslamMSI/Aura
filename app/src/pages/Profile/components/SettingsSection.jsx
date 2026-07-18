import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, Cloud, Clock3, Copy, Download, KeyRound, Laptop, Link2, Lock, LogOut, Pencil, QrCode, RefreshCw, Save, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarket } from '@/context/MarketContext';
import { TogglePref } from './ProfileShared';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const isTrustedDeviceActive = (device) => (
    device?.active !== false && !['revoked', 'expired'].includes(device?.status)
);

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
    mfaStatus = null,
    mfaFlags = {},
    mfaPolicy = null,
    mfaCenterLoading = false,
    mfaCenterLoaded = false,
    mfaCenterHasData = false,
    mfaCenterError = null,
    handleRetryMfaCenter,
    totpSetup = null,
    totpSetupCode = '',
    setTotpSetupCode,
    totpSetupLoading = false,
    totpVerifyLoading = false,
    handleStartTotpSetup,
    handleVerifyTotpSetup,
    mfaPasskeyWorking = false,
    handleRegisterMfaPasskey,
    trustedDeviceAction = '',
    handleRenameTrustedDevice,
    handleRevokeTrustedDevice,
    handleRevokeOtherTrustedDevices,
    linkedProviderIds = [],
    socialAuthStatus = {},
    providerLinking = '',
    handleLinkMicrosoftProvider,
    handleLinkAppleProvider,
}) {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const [orderUpdates, setOrderUpdates] = useState(true);
    const [marketplaceUpdates, setMarketplaceUpdates] = useState(true);
    const [supportUpdates, setSupportUpdates] = useState(true);
    const [editingDeviceId, setEditingDeviceId] = useState('');
    const [deviceLabelDraft, setDeviceLabelDraft] = useState('');
    const [confirmingRevokeDeviceId, setConfirmingRevokeDeviceId] = useState('');
    const [confirmingRevokeOthers, setConfirmingRevokeOthers] = useState(false);
    const hasVisibleRecoveryCodes = recoveryCodes.length > 0;
    const mfaMethods = mfaStatus?.methods || {};
    const passkeyCount = Number(mfaMethods?.passkey?.count || 0);
    const totpEnabled = Boolean(mfaMethods?.totp?.enabled);
    const mfaFactorReady = Boolean(mfaStatus?.enabled || hasPasskey || passkeyCount > 0 || totpEnabled);
    const recoveryReady = mfaFactorReady && passkeyRecoveryReady && !shouldEnrollRecoveryCodes;
    const mfaEnabledByDeployment = mfaFlags?.enabled !== false;
    const passkeyEnabledByDeployment = mfaEnabledByDeployment && mfaFlags?.passkeyEnabled !== false;
    const totpEnabledByDeployment = mfaEnabledByDeployment && mfaFlags?.totpEnabled !== false;
    const trustedDevices = Array.isArray(mfaStatus?.trustedDevices) ? mfaStatus.trustedDevices : [];
    const orderedTrustedDevices = [...trustedDevices].sort((left, right) => {
        if (Boolean(left?.isCurrent) !== Boolean(right?.isCurrent)) {
            return left?.isCurrent ? -1 : 1;
        }
        if (isTrustedDeviceActive(left) !== isTrustedDeviceActive(right)) {
            return isTrustedDeviceActive(left) ? -1 : 1;
        }
        return 0;
    });
    const activeTrustedDevices = orderedTrustedDevices.filter(isTrustedDeviceActive);
    const currentTrustedDevice = activeTrustedDevices.find((device) => device?.isCurrent) || null;
    const activeOtherDeviceCount = activeTrustedDevices.filter((device) => !device?.isCurrent).length;
    const deviceAudience = mfaStatus?.devicePolicy?.audience === 'admin' ? 'admin' : 'public';
    const hasMfaCenterError = Boolean(mfaCenterError);
    const showMfaCenterLoading = !mfaCenterHasData && (mfaCenterLoading || !mfaCenterLoaded);
    const showMfaCenterContent = mfaCenterHasData || (
        mfaCenterLoaded && !hasMfaCenterError && !mfaCenterLoading
    );
    const mfaCenterErrorMessage = String(mfaCenterError?.message || '').trim()
        || t('profile.settings.security.centerErrorBody', {}, 'Your security settings could not be loaded. Your factors and devices have not been changed.');
    const mfaCenterErrorReference = String(
        mfaCenterError?.serverRequestId
        || mfaCenterError?.requestId
        || ''
    ).trim();
    const linkedProviderSet = useMemo(() => new Set(linkedProviderIds), [linkedProviderIds]);
    const linkableProviders = useMemo(() => ([
        {
            id: 'microsoft.com',
            key: 'microsoft',
            label: 'Microsoft',
            enabled: Boolean(socialAuthStatus?.microsoftEnabled),
            linked: linkedProviderSet.has('microsoft.com'),
            onLink: handleLinkMicrosoftProvider,
            mark: (
                <span className="grid h-4 w-4 grid-cols-2" style={{ gap: '1px' }} aria-hidden="true">
                    <span style={{ backgroundColor: '#f25022' }} />
                    <span style={{ backgroundColor: '#7fba00' }} />
                    <span style={{ backgroundColor: '#00a4ef' }} />
                    <span style={{ backgroundColor: '#ffb900' }} />
                </span>
            ),
        },
        {
            id: 'apple.com',
            key: 'apple',
            label: 'Apple',
            enabled: Boolean(socialAuthStatus?.appleEnabled),
            linked: linkedProviderSet.has('apple.com'),
            onLink: handleLinkAppleProvider,
            mark: <span className="text-base leading-none" aria-hidden="true">A</span>,
        },
    ]).filter((provider) => provider.enabled || provider.linked), [
        handleLinkAppleProvider,
        handleLinkMicrosoftProvider,
        linkedProviderSet,
        socialAuthStatus?.appleEnabled,
        socialAuthStatus?.microsoftEnabled,
    ]);

    const lastCheckText = useMemo(() => {
        if (!trustStatus?.backend?.timestamp) return t('profile.settings.trust.noRecent', {}, 'No recent check timestamp');
        return new Date(trustStatus.backend.timestamp).toLocaleString('en-IN');
    }, [t, trustStatus?.backend?.timestamp]);

    const formatDeviceDate = (value) => {
        if (!value) return t('profile.settings.devices.never', {}, 'Never');
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return t('profile.settings.devices.unknown', {}, 'Unknown');
        return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    };

    const startDeviceRename = (device) => {
        setEditingDeviceId(device.deviceId);
        setDeviceLabelDraft(device.label || '');
        setConfirmingRevokeDeviceId('');
    };

    const submitDeviceRename = async (device) => {
        const nextLabel = deviceLabelDraft.trim();
        if (!nextLabel || !handleRenameTrustedDevice) return;
        try {
            await handleRenameTrustedDevice(device.deviceId, nextLabel);
            setEditingDeviceId('');
            setDeviceLabelDraft('');
        } catch {
            // The profile message banner presents the server error.
        }
    };

    const requestDeviceRevocation = async (device) => {
        if (confirmingRevokeDeviceId !== device.deviceId) {
            setConfirmingRevokeDeviceId(device.deviceId);
            setConfirmingRevokeOthers(false);
            return;
        }
        if (!handleRevokeTrustedDevice) return;
        try {
            await handleRevokeTrustedDevice(device.deviceId, { isCurrent: Boolean(device.isCurrent) });
            setConfirmingRevokeDeviceId('');
        } catch {
            // Keep confirmation visible so the user can retry or cancel.
        }
    };

    const requestOtherDeviceRevocation = async () => {
        if (!confirmingRevokeOthers) {
            setConfirmingRevokeOthers(true);
            setConfirmingRevokeDeviceId('');
            return;
        }
        if (!handleRevokeOtherTrustedDevices) return;
        try {
            await handleRevokeOtherTrustedDevices();
            setConfirmingRevokeOthers(false);
        } catch {
            // Keep confirmation visible so the user can retry or cancel.
        }
    };

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

                    {linkableProviders.length > 0 ? (
                        <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <p className="flex items-center gap-2 text-sm font-semibold text-white">
                                        <Link2 className="h-4 w-4 text-neo-cyan" />
                                        {t('profile.settings.security.linkedProviders', {}, 'Linked sign-in providers')}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                        {t('profile.settings.security.linkedProvidersBody', {}, 'Attach another provider after signing in with the method that already owns this email.')}
                                    </p>
                                </div>
                                <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                                    {linkableProviders.map((provider) => {
                                        const isLinking = providerLinking === provider.key;
                                        const disabled = provider.linked || !provider.enabled || isLinking || !provider.onLink;
                                        return (
                                            <button
                                                key={provider.id}
                                                type="button"
                                                onClick={provider.onLink}
                                                disabled={disabled}
                                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                            >
                                                {provider.mark}
                                                {provider.linked
                                                    ? t('profile.settings.security.providerLinked', { provider: provider.label }, `${provider.label} linked`)
                                                    : isLinking
                                                        ? t('profile.settings.security.providerLinking', { provider: provider.label }, `Linking ${provider.label}...`)
                                                        : t('profile.settings.security.providerLink', { provider: provider.label }, `Link ${provider.label}`)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {showMfaCenterLoading ? (
                        <div className="rounded-[1.6rem] border border-cyan-300/20 bg-cyan-400/10 p-5" role="status" aria-live="polite">
                            <div className="flex items-center gap-3">
                                <RefreshCw className="h-5 w-5 animate-spin text-cyan-100" aria-hidden="true" />
                                <div>
                                    <p className="text-sm font-black text-white">
                                        {t('profile.settings.security.centerLoadingTitle', {}, 'Loading security settings')}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-300">
                                        {t('profile.settings.security.centerLoadingBody', {}, 'Checking your passkeys, MFA methods, signed-in devices, and remembered browsers.')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {hasMfaCenterError ? (
                        <div className="rounded-[1.6rem] border border-rose-300/25 bg-rose-400/10 p-5" role="alert">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 gap-3">
                                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" aria-hidden="true" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-white">
                                            {t('profile.settings.security.centerErrorTitle', {}, 'Security settings could not load')}
                                        </p>
                                        <p className="mt-1 break-words text-xs leading-5 text-rose-100">{mfaCenterErrorMessage}</p>
                                        {mfaCenterErrorReference ? (
                                            <p className="mt-2 text-[11px] font-semibold text-rose-200">
                                                {t('profile.settings.security.centerErrorReference', { reference: mfaCenterErrorReference }, `Reference: ${mfaCenterErrorReference}`)}
                                            </p>
                                        ) : null}
                                        {mfaCenterHasData ? (
                                            <p className="mt-2 text-[11px] font-semibold text-slate-300">
                                                {t('profile.settings.security.centerStaleData', {}, 'Showing the last security settings loaded on this page.')}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRetryMfaCenter}
                                    disabled={mfaCenterLoading || !handleRetryMfaCenter}
                                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-200/25 bg-rose-200/10 px-4 text-sm font-black text-rose-50 hover:bg-rose-200/15 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-4 w-4 ${mfaCenterLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                                    {mfaCenterLoading
                                        ? t('common.retrying', {}, 'Retrying...')
                                        : t('common.retry', {}, 'Retry')}
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {mfaCenterLoading && mfaCenterHasData && !hasMfaCenterError ? (
                        <p className="flex items-center gap-2 text-xs font-semibold text-cyan-100" role="status" aria-live="polite">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            {t('profile.settings.security.centerRefreshing', {}, 'Refreshing security settings...')}
                        </p>
                    ) : null}

                    {showMfaCenterContent ? (
                    <>
                    <section aria-labelledby="passkeys-mfa-heading" className={`rounded-[1.6rem] border p-4 ${mfaFactorReady ? 'border-emerald-400/20 bg-emerald-500/12' : 'border-cyan-300/20 bg-cyan-400/10'}`}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${mfaFactorReady ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100'}`}>
                                        {mfaFactorReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                                        {mfaFactorReady
                                            ? t('profile.settings.security.mfaReady', {}, 'MFA ready')
                                            : t('profile.settings.security.mfaAvailable', {}, 'MFA available')}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-300">
                                        {mfaCenterLoading
                                            ? t('profile.settings.security.mfaChecking', {}, 'Checking factors...')
                                            : t(
                                                'profile.settings.security.mfaFactorSummary',
                                                { passkeys: passkeyCount, totp: totpEnabled ? 1 : 0 },
                                                `${passkeyCount} passkeys | ${totpEnabled ? 1 : 0} authenticator apps`,
                                            )}
                                    </span>
                                </div>
                                <h4 id="passkeys-mfa-heading" className="mt-3 flex items-center gap-2 text-sm font-black text-white">
                                    <ShieldCheck className="h-4 w-4 text-neo-cyan" />
                                    {t('profile.settings.security.passkeysAndMfaTitle', {}, 'Passkeys and MFA')}
                                </h4>
                                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300">
                                    {mfaPolicy?.reason
                                        ? t('profile.settings.security.mfaPolicyReason', { reason: mfaPolicy.reason }, `Current policy: ${mfaPolicy.reason}`)
                                        : t('profile.settings.security.mfaBody', {}, 'Passkeys, authenticator app codes, and one-time recovery codes protect sign-in and sensitive account changes.')}
                                </p>
                            </div>
                            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={handleRegisterMfaPasskey}
                                    disabled={mfaPasskeyWorking || !passkeyEnabledByDeployment || !handleRegisterMfaPasskey}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <KeyRound className="h-4 w-4" />
                                    {mfaPasskeyWorking
                                        ? t('profile.settings.security.passkeyRegistering', {}, 'Registering...')
                                        : t('profile.settings.security.passkeyRegister', {}, 'Register passkey')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleStartTotpSetup}
                                    disabled={totpSetupLoading || !totpEnabledByDeployment || !handleStartTotpSetup}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Smartphone className="h-4 w-4" />
                                    {totpSetupLoading
                                        ? t('profile.settings.security.totpStarting', {}, 'Starting...')
                                        : totpEnabled
                                            ? t('profile.settings.security.totpRotate', {}, 'Rotate app key')
                                            : t('profile.settings.security.totpStart', {}, 'Set up app')}
                                </button>
                            </div>
                        </div>

                        {!mfaFactorReady && !mfaCenterLoading ? (
                            <div className="mt-4 rounded-xl border border-dashed border-cyan-200/25 bg-black/15 px-4 py-4" role="status">
                                <p className="text-sm font-bold text-white">
                                    {t('profile.settings.security.mfaEmptyTitle', {}, 'No MFA method enrolled yet')}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-slate-300">
                                    {t('profile.settings.security.mfaEmptyBody', {}, 'Register a passkey or set up an authenticator app to add a second sign-in factor.')}
                                </p>
                            </div>
                        ) : null}

                        {totpSetup ? (
                            <div className="mt-4 grid gap-4 rounded-[1.4rem] border border-cyan-300/20 bg-slate-950/45 p-4 md:grid-cols-[auto,1fr]">
                                {totpSetup.qrCodeDataUrl ? (
                                    <img
                                        src={totpSetup.qrCodeDataUrl}
                                        alt={t('profile.settings.security.totpQrAlt', {}, 'Authenticator setup QR code')}
                                        className="h-36 w-36 rounded-xl border border-white/10 bg-white p-2"
                                    />
                                ) : (
                                    <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-cyan-100">
                                        <QrCode className="h-10 w-10" />
                                    </div>
                                )}
                                <div className="min-w-0 space-y-3">
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
                                            {t('profile.settings.security.totpPending', {}, 'Authenticator pending')}
                                        </p>
                                        <code className="mt-2 block break-all rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs font-black tracking-[0.14em] text-cyan-50">
                                            {totpSetup.manualKey}
                                        </code>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input
                                            value={totpSetupCode}
                                            onChange={(event) => setTotpSetupCode?.(event.target.value)}
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            maxLength={8}
                                            aria-label={t('profile.settings.security.totpCodeLabel', {}, 'Authenticator code')}
                                            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40"
                                            placeholder={t('profile.settings.security.totpCodePlaceholder', {}, '6-digit code')}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleVerifyTotpSetup}
                                            disabled={totpVerifyLoading || !handleVerifyTotpSetup}
                                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/12 px-4 text-sm font-black text-emerald-100 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                            {totpVerifyLoading
                                                ? t('profile.settings.security.totpVerifying', {}, 'Verifying...')
                                                : t('profile.settings.security.totpVerify', {}, 'Verify app')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </section>

                    <section
                        aria-labelledby="signed-in-devices-heading"
                        className="rounded-[1.6rem] border border-violet-300/20 bg-violet-400/[0.08] p-4"
                    >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-100">
                                        <Laptop className="h-3.5 w-3.5" />
                                        {t('profile.settings.devices.activeCount', { count: activeTrustedDevices.length }, `${activeTrustedDevices.length} active`)}
                                    </span>
                                    {currentTrustedDevice ? (
                                        <span className="text-xs font-semibold text-emerald-200">
                                            {t('profile.settings.devices.currentBound', {}, 'This browser is identified')}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-semibold text-amber-200">
                                            {t('profile.settings.devices.currentUnbound', {}, 'This session is not bound to a managed device')}
                                        </span>
                                    )}
                                </div>
                                <h4 id="signed-in-devices-heading" className="mt-3 flex items-center gap-2 text-sm font-black text-white">
                                    <ShieldCheck className="h-4 w-4 text-violet-200" />
                                    {t('profile.settings.devices.signedInTitle', {}, 'Signed-in devices and remembered browsers')}
                                </h4>
                                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300">
                                    {deviceAudience === 'admin'
                                        ? t('profile.settings.devices.adminBody', {}, 'Admin access accepts only verified, user-verified passkeys. A remembered browser improves recognition but never satisfies admin MFA.')
                                        : t('profile.settings.devices.publicBody', {}, 'A remembered browser can reduce recognition prompts, but it is not MFA. Passkeys protect MFA; a synced passkey may be available on more than one physical device.')}
                                </p>
                            </div>

                            {activeOtherDeviceCount > 0 ? (
                                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                                    <button
                                        type="button"
                                        onClick={requestOtherDeviceRevocation}
                                        disabled={!currentTrustedDevice || trustedDeviceAction === 'revoke-others' || !handleRevokeOtherTrustedDevices}
                                        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${confirmingRevokeOthers ? 'border-red-300/35 bg-red-500/20 text-red-100' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        {trustedDeviceAction === 'revoke-others'
                                            ? t('profile.settings.devices.revokingOthers', {}, 'Revoking...')
                                            : confirmingRevokeOthers
                                                ? t('profile.settings.devices.confirmRevokeOthers', { count: activeOtherDeviceCount }, `Confirm revoke ${activeOtherDeviceCount}`)
                                                : t('profile.settings.devices.revokeOthers', {}, 'Revoke all others')}
                                    </button>
                                    {confirmingRevokeOthers ? (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingRevokeOthers(false)}
                                            className="min-h-10 rounded-lg px-3 text-xs font-bold text-slate-300 hover:bg-white/5 hover:text-white"
                                        >
                                            {t('common.cancel', {}, 'Cancel')}
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {deviceAudience === 'admin' ? (
                            <div className="mt-4 flex gap-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                <p>{t('profile.settings.devices.adminWarning', {}, 'Keep at least one independent admin passkey. The server blocks removal of the final policy-required admin factor.')}</p>
                            </div>
                        ) : null}

                        {orderedTrustedDevices.length === 0 ? (
                            <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/15 px-4 py-6 text-center">
                                <Laptop className="mx-auto h-6 w-6 text-slate-400" />
                                <p className="mt-2 text-sm font-bold text-white">
                                    {t('profile.settings.devices.emptySignedInTitle', {}, 'No signed-in devices or remembered browsers')}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                    {t('profile.settings.devices.emptySignedInBody', {}, 'A device appears here after it completes browser recognition. Browser recognition helps identify a device, but it is not MFA.')}
                                </p>
                            </div>
                        ) : (
                            <div className="mt-4 grid gap-3">
                                {orderedTrustedDevices.map((device) => {
                                    const active = isTrustedDeviceActive(device);
                                    const isPasskeyDevice = device?.method === 'webauthn';
                                    const isEditing = editingDeviceId === device.deviceId;
                                    const isConfirmingRevoke = confirmingRevokeDeviceId === device.deviceId;
                                    const renameWorking = trustedDeviceAction === `rename:${device.deviceId}`;
                                    const revokeWorking = trustedDeviceAction === `revoke:${device.deviceId}`;
                                    const factorLabel = isPasskeyDevice
                                        ? (device.adminEligible
                                            ? t('profile.settings.devices.adminPasskey', {}, 'Admin passkey')
                                            : device.isMfaFactor
                                                ? t('profile.settings.devices.mfaPasskey', {}, 'MFA passkey')
                                                : t('profile.settings.devices.recognitionPasskey', {}, 'Recognition passkey'))
                                        : t('profile.settings.devices.rememberedBrowserNotMfa', {}, 'Remembered browser - not MFA');
                                    const syncLabel = isPasskeyDevice
                                        ? (device.backedUp
                                            ? t('profile.settings.devices.syncedPasskey', {}, 'Synced passkey')
                                            : device.backupEligible
                                                ? t('profile.settings.devices.syncEligible', {}, 'Sync eligible')
                                                : t('profile.settings.devices.deviceBound', {}, 'Device-bound or sync unknown'))
                                        : '';

                                    return (
                                        <article
                                            key={device.deviceId}
                                            className={`rounded-[1.25rem] border p-4 ${active ? 'border-white/10 bg-slate-950/35' : 'border-white/5 bg-black/20 opacity-70'}`}
                                        >
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {isPasskeyDevice ? <KeyRound className="h-4 w-4 text-violet-200" /> : <Laptop className="h-4 w-4 text-cyan-200" />}
                                                        {isEditing ? (
                                                            <label className="min-w-0 flex-1">
                                                                <span className="sr-only">{t('profile.settings.devices.nameLabel', {}, 'Device name')}</span>
                                                                <input
                                                                    value={deviceLabelDraft}
                                                                    onChange={(event) => setDeviceLabelDraft(event.target.value)}
                                                                    maxLength={120}
                                                                    autoFocus
                                                                    className="min-h-11 w-full rounded-xl border border-violet-300/30 bg-black/30 px-3 text-sm font-bold text-white outline-none focus:border-violet-200"
                                                                    aria-label={t('profile.settings.devices.nameFor', { device: device.label }, `Name for ${device.label}`)}
                                                                />
                                                            </label>
                                                        ) : (
                                                            <p className="truncate text-sm font-black text-white">{device.label}</p>
                                                        )}
                                                        {device.isCurrent ? (
                                                            <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-100">
                                                                {t('profile.settings.devices.current', {}, 'Current')}
                                                            </span>
                                                        ) : null}
                                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${active ? 'border-sky-300/20 bg-sky-400/10 text-sky-100' : 'border-slate-400/20 bg-slate-500/10 text-slate-300'}`}>
                                                            {device.status || (active ? 'active' : 'inactive')}
                                                        </span>
                                                    </div>

                                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-300">
                                                        <span>{factorLabel}</span>
                                                        {syncLabel ? (
                                                            <span className="inline-flex items-center gap-1"><Cloud className="h-3 w-3" />{syncLabel}</span>
                                                        ) : null}
                                                        <span>{t('profile.settings.devices.lastVerified', { date: formatDeviceDate(device.lastVerifiedAt || device.lastSeenAt) }, `Last verified ${formatDeviceDate(device.lastVerifiedAt || device.lastSeenAt)}`)}</span>
                                                    </div>

                                                    {device.adminEligibility === 'legacy_candidate' ? (
                                                        <p className="mt-2 text-[11px] font-semibold text-amber-200">
                                                            {t('profile.settings.devices.legacyAdminWarning', {}, 'Fresh passkey verification is required before this credential can protect admin actions.')}
                                                        </p>
                                                    ) : null}
                                                    {device.isCurrent && isConfirmingRevoke ? (
                                                        <p className="mt-2 text-[11px] font-semibold text-red-200">
                                                            {t('profile.settings.devices.currentRevokeWarning', {}, 'Revoking this device signs you out and removes its local trust identity.')}
                                                        </p>
                                                    ) : null}
                                                </div>

                                                {active ? (
                                                    <div className="flex flex-wrap gap-2 sm:justify-end">
                                                        {isEditing ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => submitDeviceRename(device)}
                                                                    disabled={renameWorking || !deviceLabelDraft.trim() || deviceLabelDraft.trim() === device.label}
                                                                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 disabled:opacity-50"
                                                                >
                                                                    <Save className="h-3.5 w-3.5" />
                                                                    {renameWorking ? t('common.saving', {}, 'Saving...') : t('common.save', {}, 'Save')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setEditingDeviceId(''); setDeviceLabelDraft(''); }}
                                                                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-black text-slate-200"
                                                                    aria-label={t('profile.settings.devices.cancelRename', {}, 'Cancel rename')}
                                                                >
                                                                    <X className="h-3.5 w-3.5" />
                                                                    {t('common.cancel', {}, 'Cancel')}
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => startDeviceRename(device)}
                                                                disabled={trustedDeviceAction !== '' || !handleRenameTrustedDevice || device.canRename === false}
                                                                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-black text-white hover:bg-white/10 disabled:opacity-50"
                                                                aria-label={t('profile.settings.devices.renameAria', { device: device.label }, `Rename ${device.label}`)}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                                {t('common.rename', {}, 'Rename')}
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => requestDeviceRevocation(device)}
                                                            disabled={revokeWorking || !handleRevokeTrustedDevice || device.canRevoke === false}
                                                            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-black disabled:opacity-50 ${isConfirmingRevoke ? 'border-red-300/35 bg-red-500/20 text-red-100' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-red-500/10 hover:text-red-100'}`}
                                                            aria-label={isConfirmingRevoke
                                                                ? t('profile.settings.devices.confirmRevokeAria', { device: device.label }, `Confirm revoke ${device.label}`)
                                                                : t('profile.settings.devices.revokeAria', { device: device.label }, `Revoke ${device.label}`)}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                            {revokeWorking
                                                                ? t('common.revoking', {}, 'Revoking...')
                                                                : isConfirmingRevoke
                                                                    ? t('common.confirm', {}, 'Confirm')
                                                                    : device.isCurrent
                                                                        ? t('profile.settings.devices.revokeAndSignOut', {}, 'Revoke & sign out')
                                                                        : t('common.revoke', {}, 'Revoke')}
                                                        </button>
                                                        {isConfirmingRevoke ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => setConfirmingRevokeDeviceId('')}
                                                                className="min-h-11 rounded-xl px-3 text-xs font-bold text-slate-300 hover:bg-white/5"
                                                            >
                                                                {t('common.cancel', {}, 'Cancel')}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </section>

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
                                <h4 className="mt-3 flex items-center gap-2 text-sm font-black text-white">
                                    <ShieldCheck className="h-4 w-4 text-neo-cyan" />
                                    {t('profile.settings.security.recoveryCodesTitle', {}, 'MFA backup recovery codes')}
                                </h4>
                                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300">
                                    {mfaFactorReady
                                        ? t('profile.settings.security.recoveryCodesBody', {}, 'Generate one-time backup codes so this MFA account has a recovery path that still stays server-gated and single-use.')
                                        : t('profile.settings.security.recoveryCodesPasskeyFirst', {}, 'Add a passkey or authenticator app first. Backup recovery codes are available after MFA is enrolled.')}
                                </p>
                                {shouldEnrollRecoveryCodes ? (
                                    <p className="mt-2 text-[11px] font-semibold text-amber-100">
                                        {t('profile.settings.security.recoveryCodesEnrollHint', {}, 'This account has MFA protection but no backup codes yet. Generate them after a fresh security checkpoint.')}
                                    </p>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                onClick={handleGenerateRecoveryCodes}
                                disabled={recoveryCodesGenerating || !mfaFactorReady || !handleGenerateRecoveryCodes}
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
                    </>
                    ) : null}

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
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm font-black text-rose-100 hover:bg-rose-500/20"
                    >
                        <LogOut className="h-4 w-4" />
                        {t('profile.settings.safety.logout', {}, 'Log Out')}
                    </button>
                </div>
            </div>
        </div>
    );
}
