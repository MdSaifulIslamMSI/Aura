import { useCallback, useState } from 'react';
import { authApi, trustApi } from '@/services/api';
import { isTrustedDeviceChallengeError } from '@/utils/authStepUp';
import {
    ACCOUNT_TELEMETRY_EVENTS,
    trackAccountEvent,
} from '@/services/accountTelemetry';
import { trimText } from './profileUtils';

const DEFAULT_TRUST_STATUS = {
    backend: { status: 'degraded', db: 'unknown', uptime: 0, timestamp: null },
    client: { online: true, secureContext: false, language: 'unknown', timezone: 'unknown' },
    derivedStatus: 'degraded',
};

export function useSecurityCenter({
    canUseProtectedProfileApis,
    currentUser,
    dbUser,
    profile,
    sessionIntelligence,
    showMsg,
    t,
    logout,
    navigate,
    refreshProfileDeck,
    contextFns = {},
}) {
    const {
        generateRecoveryCodes,
        startTotpSetup,
        verifyTotpSetup,
        registerMfaPasskey,
        renameTrustedDeviceInContext,
        revokeTrustedDeviceInContext,
        revokeOtherTrustedDevicesInContext,
        regenerateMfaRecoveryCodes,
        linkMicrosoftProvider,
        linkAppleProvider,
    } = contextFns;

    const [trustStatus, setTrustStatus] = useState(DEFAULT_TRUST_STATUS);
    const [trustLoading, setTrustLoading] = useState(false);
    const [mfaCenter, setMfaCenter] = useState(null);
    const [mfaCenterLoading, setMfaCenterLoading] = useState(false);
    const [mfaCenterLoaded, setMfaCenterLoaded] = useState(false);
    const [mfaCenterError, setMfaCenterError] = useState(null);
    const [totpSetup, setTotpSetup] = useState(null);
    const [totpSetupCode, setTotpSetupCode] = useState('');
    const [totpSetupLoading, setTotpSetupLoading] = useState(false);
    const [totpVerifyLoading, setTotpVerifyLoading] = useState(false);
    const [mfaPasskeyWorking, setMfaPasskeyWorking] = useState(false);
    const [trustedDeviceAction, setTrustedDeviceAction] = useState('');
    const [activeSessions, setActiveSessions] = useState([]);
    const [activeSessionsLoading, setActiveSessionsLoading] = useState(false);
    const [activeSessionsLoaded, setActiveSessionsLoaded] = useState(false);
    const [activeSessionsError, setActiveSessionsError] = useState(null);
    const [activeSessionAction, setActiveSessionAction] = useState('');
    const [securityActivity, setSecurityActivity] = useState([]);
    const [securityActivityPagination, setSecurityActivityPagination] = useState({
        hasMore: false,
        nextCursor: null,
    });
    const [securityActivityRetentionDays, setSecurityActivityRetentionDays] = useState(180);
    const [securityActivityLoading, setSecurityActivityLoading] = useState(false);
    const [securityActivityLoaded, setSecurityActivityLoaded] = useState(false);
    const [securityActivityError, setSecurityActivityError] = useState(null);
    const [visibleRecoveryCodes, setVisibleRecoveryCodes] = useState([]);
    const [recoveryCodesGenerating, setRecoveryCodesGenerating] = useState(false);
    const [providerLinking, setProviderLinking] = useState('');

    const recoveryReadiness = sessionIntelligence?.readiness || {};
    const mfaStatus = mfaCenter?.mfa || profile?.mfa || dbUser?.mfa || null;
    const mfaFlags = mfaCenter?.flags || {};
    const mfaPolicy = mfaCenter?.policy || null;
    const mfaHookMethods = mfaStatus?.methods || {};
    const hasMfaFactor = Boolean(
        recoveryReadiness.hasPasskey
        || mfaHookMethods?.totp?.enabled
        || mfaStatus?.enabled
        || Number(mfaHookMethods?.passkey?.count || 0) > 0
    );

    const refreshTrustStatus = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setTrustStatus(DEFAULT_TRUST_STATUS);
            setTrustLoading(false);
            return DEFAULT_TRUST_STATUS;
        }

        if (!silent) {
            setTrustLoading(true);
        }
        try {
            const nextStatus = await trustApi.getHealthStatus();
            setTrustStatus(nextStatus || DEFAULT_TRUST_STATUS);
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Trust status fetch failed:', error);
            }
            setTrustStatus((previous) => ({
                ...previous,
                derivedStatus: 'degraded',
                backend: { ...(previous?.backend || DEFAULT_TRUST_STATUS.backend), status: 'degraded' },
            }));
        } finally {
            if (!silent) {
                setTrustLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshMfaCenter = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setMfaCenter(null);
            setMfaCenterError(null);
            setMfaCenterLoaded(false);
            setMfaCenterLoading(false);
            return null;
        }

        if (!silent) {
            setMfaCenterLoading(true);
            setMfaCenterError(null);
        }

        try {
            const nextCenter = await authApi.getMfaSecurityCenter({ firebaseUser: currentUser });
            setMfaCenter(nextCenter || null);
            setMfaCenterError(null);
            setMfaCenterLoaded(true);
            return nextCenter || null;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error) && Number(error?.status || 0) !== 403) {
                console.error('MFA security center fetch failed:', error);
            }
            setMfaCenterError(error);
            setMfaCenterLoaded(true);
            return null;
        } finally {
            if (!silent) {
                setMfaCenterLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, currentUser]);

    const refreshActiveSessions = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setActiveSessions([]);
            setActiveSessionsError(null);
            setActiveSessionsLoaded(false);
            setActiveSessionsLoading(false);
            return [];
        }

        if (!silent) {
            setActiveSessionsLoading(true);
            setActiveSessionsError(null);
        }

        try {
            const result = await authApi.getAccountSessions({ firebaseUser: currentUser });
            const nextSessions = Array.isArray(result?.data) ? result.data : [];
            setActiveSessions(nextSessions);
            setActiveSessionsError(null);
            setActiveSessionsLoaded(true);
            return nextSessions;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Active sessions fetch failed:', error);
            }
            setActiveSessionsError(error);
            setActiveSessionsLoaded(true);
            return null;
        } finally {
            if (!silent) {
                setActiveSessionsLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, currentUser]);

    const refreshSecurityActivity = useCallback(async ({
        silent = false,
        append = false,
        cursor = null,
    } = {}) => {
        if (!canUseProtectedProfileApis) {
            setSecurityActivity([]);
            setSecurityActivityPagination({ hasMore: false, nextCursor: null });
            setSecurityActivityError(null);
            setSecurityActivityLoaded(false);
            setSecurityActivityLoading(false);
            return [];
        }

        if (!silent) {
            setSecurityActivityLoading(true);
            setSecurityActivityError(null);
        }

        try {
            const result = await authApi.getAccountSecurityActivity(
                { cursor: cursor || '', limit: 20 },
                { firebaseUser: currentUser }
            );
            const nextActivity = Array.isArray(result?.activity) ? result.activity : [];
            setSecurityActivity((current) => append ? [...current, ...nextActivity] : nextActivity);
            setSecurityActivityPagination({
                hasMore: Boolean(result?.pagination?.hasMore),
                nextCursor: result?.pagination?.nextCursor || null,
            });
            setSecurityActivityRetentionDays(Number(result?.retentionDays || 180));
            setSecurityActivityError(null);
            setSecurityActivityLoaded(true);
            return nextActivity;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Security activity fetch failed:', error);
            }
            setSecurityActivityError(error);
            setSecurityActivityLoaded(true);
            return null;
        } finally {
            if (!silent) {
                setSecurityActivityLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, currentUser]);

    const handleGenerateBackupRecoveryCodes = useCallback(async () => {
        if (!hasMfaFactor) {
            showMsg('error', t('profile.message.recoveryCodesNeedPasskey', {}, 'Add a passkey or authenticator app before generating backup recovery codes.'));
            return;
        }

        const recoveryCodeGenerator = regenerateMfaRecoveryCodes || generateRecoveryCodes;
        if (!recoveryCodeGenerator) {
            showMsg('error', t('profile.message.recoveryCodesUnavailable', {}, 'Recovery-code setup is not available in this session yet.'));
            return;
        }

        setRecoveryCodesGenerating(true);

        try {
            const result = await recoveryCodeGenerator();
            const nextCodes = Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [];
            setVisibleRecoveryCodes(nextCodes);
            await Promise.all([
                refreshMfaCenter({ silent: true }),
                refreshProfileDeck({ silent: true }),
            ]);
            showMsg(
                'success',
                t(
                    'profile.message.recoveryCodesGenerated',
                    { count: nextCodes.length },
                    `${nextCodes.length} backup recovery codes generated. They are shown once.`,
                ),
            );
        } catch (error) {
            showMsg(
                'error',
                error.message || t('profile.message.recoveryCodesFailed', {}, 'Could not generate backup recovery codes. Complete the passkey checkpoint and try again.'),
            );
        } finally {
            setRecoveryCodesGenerating(false);
        }
    }, [generateRecoveryCodes, hasMfaFactor, refreshMfaCenter, refreshProfileDeck, regenerateMfaRecoveryCodes, showMsg, t]);

    const handleStartTotpSetup = useCallback(async () => {
        if (!startTotpSetup) {
            showMsg('error', t('profile.message.totpUnavailable', {}, 'Authenticator app setup is not available in this session.'));
            return;
        }

        setTotpSetupLoading(true);
        try {
            const result = await startTotpSetup();
            setTotpSetup(result || null);
            setTotpSetupCode('');
            showMsg('success', t('profile.message.totpSetupStarted', {}, 'Authenticator app setup started.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.totpSetupFailed', {}, 'Could not start authenticator app setup.'));
        } finally {
            setTotpSetupLoading(false);
        }
    }, [showMsg, startTotpSetup, t]);

    const handleVerifyTotpSetup = useCallback(async () => {
        const code = trimText(totpSetupCode);
        if (!code) {
            showMsg('error', t('profile.message.totpCodeRequired', {}, 'Enter the authenticator code to finish setup.'));
            return;
        }
        if (!verifyTotpSetup) {
            showMsg('error', t('profile.message.totpUnavailable', {}, 'Authenticator app setup is not available in this session.'));
            return;
        }

        setTotpVerifyLoading(true);
        try {
            const result = await verifyTotpSetup(code);
            const nextCodes = Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [];
            if (nextCodes.length) {
                setVisibleRecoveryCodes(nextCodes);
            }
            setTotpSetup(null);
            setTotpSetupCode('');
            await Promise.all([
                refreshMfaCenter({ silent: true }),
                refreshProfileDeck({ silent: true }),
            ]);
            showMsg('success', t('profile.message.totpEnabled', {}, 'Authenticator app MFA enabled.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.totpVerifyFailed', {}, 'Could not verify the authenticator code.'));
        } finally {
            setTotpVerifyLoading(false);
        }
    }, [refreshMfaCenter, refreshProfileDeck, showMsg, t, totpSetupCode, verifyTotpSetup]);

    const handleRegisterMfaPasskey = useCallback(async () => {
        if (!registerMfaPasskey) {
            showMsg('error', t('profile.message.passkeyUnavailable', {}, 'Passkey registration is not available in this session.'));
            return;
        }

        setMfaPasskeyWorking(true);
        try {
            await registerMfaPasskey();
            await Promise.all([
                refreshMfaCenter({ silent: true }),
                refreshProfileDeck({ silent: true }),
            ]);
            showMsg('success', t('profile.message.passkeyRegistered', {}, 'Passkey MFA registered.'));
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.PASSKEY_ADDED);
        } catch (error) {
            showMsg('error', error.message || t('profile.message.passkeyRegisterFailed', {}, 'Could not register this passkey.'));
        } finally {
            setMfaPasskeyWorking(false);
        }
    }, [refreshMfaCenter, refreshProfileDeck, registerMfaPasskey, showMsg, t]);

    const applyTrustedDeviceMutation = useCallback(async ({ actionKey, operation, successMessage }) => {
        setTrustedDeviceAction(actionKey);
        try {
            const result = await operation();
            if (result?.mfa) {
                setMfaCenter((previous) => ({ ...(previous || {}), success: true, mfa: result.mfa }));
            } else if (!result?.revokedCurrentDevice) {
                await refreshMfaCenter({ silent: true });
            }
            showMsg('success', successMessage);
            return result;
        } catch (error) {
            showMsg(
                'error',
                error.message || t('profile.message.trustedDeviceActionFailed', {}, 'Could not update this trusted device.')
            );
            throw error;
        } finally {
            setTrustedDeviceAction('');
        }
    }, [refreshMfaCenter, showMsg, t]);

    const handleRenameTrustedDevice = useCallback(async (deviceId, label) => {
        if (!renameTrustedDeviceInContext) {
            throw new Error(t('profile.message.trustedDeviceUnavailable', {}, 'Trusted-device management is unavailable in this session.'));
        }
        return applyTrustedDeviceMutation({
            actionKey: `rename:${deviceId}`,
            operation: () => renameTrustedDeviceInContext({ deviceId, label }),
            successMessage: t('profile.message.trustedDeviceRenamed', {}, 'Trusted device renamed.'),
        });
    }, [applyTrustedDeviceMutation, renameTrustedDeviceInContext, t]);

    const handleRevokeTrustedDevice = useCallback(async (deviceId, { isCurrent = false } = {}) => {
        if (!revokeTrustedDeviceInContext) {
            throw new Error(t('profile.message.trustedDeviceUnavailable', {}, 'Trusted-device management is unavailable in this session.'));
        }
        return applyTrustedDeviceMutation({
            actionKey: `revoke:${deviceId}`,
            operation: () => revokeTrustedDeviceInContext({ deviceId }),
            successMessage: isCurrent
                ? t('profile.message.currentTrustedDeviceRevoked', {}, 'This device was revoked. You are being signed out.')
                : t('profile.message.trustedDeviceRevoked', {}, 'Trusted device revoked.'),
        });
    }, [applyTrustedDeviceMutation, revokeTrustedDeviceInContext, t]);

    const handleRevokeOtherTrustedDevices = useCallback(async () => {
        if (!revokeOtherTrustedDevicesInContext) {
            throw new Error(t('profile.message.trustedDeviceUnavailable', {}, 'Trusted-device management is unavailable in this session.'));
        }
        return applyTrustedDeviceMutation({
            actionKey: 'revoke-others',
            operation: () => revokeOtherTrustedDevicesInContext(),
            successMessage: t('profile.message.otherTrustedDevicesRevoked', {}, 'Other trusted devices were revoked.'),
        });
    }, [applyTrustedDeviceMutation, revokeOtherTrustedDevicesInContext, t]);

    const handleRevokeActiveSession = useCallback(async (session) => {
        const sessionId = String(session?.id || '').trim();
        setActiveSessionAction(`revoke:${sessionId}`);
        try {
            const result = await authApi.revokeAccountSession(
                { sessionId },
                { firebaseUser: currentUser }
            );
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.SESSION_REVOKED, {
                scope: session?.current ? 'current' : 'one',
            });

            if (session?.current) {
                showMsg('success', t('profile.message.currentSessionRevoked', {}, 'This browser session was revoked. You are being signed out.'));
                await logout?.();
                navigate('/login', { replace: true });
                return result;
            }

            await refreshActiveSessions({ silent: true });
            showMsg('success', t('profile.message.sessionRevoked', {}, 'Browser session signed out.'));
            return result;
        } catch (error) {
            showMsg('error', error.message || t('profile.message.sessionRevokeFailed', {}, 'Could not sign out this browser session.'));
            throw error;
        } finally {
            setActiveSessionAction('');
        }
    }, [currentUser, logout, navigate, refreshActiveSessions, showMsg, t]);

    const handleRevokeOtherActiveSessions = useCallback(async () => {
        setActiveSessionAction('revoke-others');
        try {
            const result = await authApi.revokeOtherAccountSessions({ firebaseUser: currentUser });
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.SESSION_REVOKED, {
                scope: 'others',
            });
            await refreshActiveSessions({ silent: true });
            const revoked = Number(result?.revoked || 0);
            const revokedMessage = revoked === 1
                ? t(
                    'profile.message.otherSessionRevoked',
                    { count: revoked },
                    `${revoked} other browser session was signed out.`
                )
                : t(
                    'profile.message.otherSessionsRevoked',
                    { count: revoked },
                    `${revoked} other browser sessions were signed out.`
                );
            showMsg('success', revokedMessage);
            return result;
        } catch (error) {
            showMsg('error', error.message || t('profile.message.otherSessionsRevokeFailed', {}, 'Could not sign out the other browser sessions.'));
            throw error;
        } finally {
            setActiveSessionAction('');
        }
    }, [currentUser, refreshActiveSessions, showMsg, t]);

    const handleRevokeAllActiveSessions = useCallback(async () => {
        setActiveSessionAction('revoke-all');
        try {
            const result = await authApi.revokeAllAccountSessions({ firebaseUser: currentUser });
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.SESSION_REVOKED, {
                scope: 'all',
            });
            showMsg('success', t(
                'profile.message.allSessionsRevoked',
                {},
                'Every browser session was revoked. You are being signed out.'
            ));
            await logout?.();
            navigate('/login', { replace: true });
            return result;
        } catch (error) {
            showMsg('error', error.message || t(
                'profile.message.allSessionsRevokeFailed',
                {},
                'Could not sign out every browser session.'
            ));
            throw error;
        } finally {
            setActiveSessionAction('');
        }
    }, [currentUser, logout, navigate, showMsg, t]);

    const handleCopyRecoveryCodes = useCallback(async () => {
        if (!visibleRecoveryCodes.length) return;

        try {
            await navigator.clipboard.writeText(visibleRecoveryCodes.join('\n'));
            showMsg('success', t('profile.message.recoveryCodesCopied', {}, 'Backup recovery codes copied.'));
        } catch {
            showMsg('error', t('profile.message.recoveryCodesCopyFailed', {}, 'Could not copy recovery codes from this browser.'));
        }
    }, [showMsg, t, visibleRecoveryCodes]);

    const handleDownloadRecoveryCodes = useCallback(() => {
        if (!visibleRecoveryCodes.length || typeof window === 'undefined') return;

        const generatedAt = new Date().toISOString();
        const contents = [
            'Aura backup recovery codes',
            `Generated: ${generatedAt}`,
            'Use each code once from the secure recovery flow.',
            '',
            ...visibleRecoveryCodes,
            '',
        ].join('\n');
        const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `aura-recovery-codes-${generatedAt.slice(0, 10)}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL?.(url);
        showMsg('success', t('profile.message.recoveryCodesDownloaded', {}, 'Backup recovery codes downloaded.'));
    }, [showMsg, t, visibleRecoveryCodes]);

    const clearVisibleRecoveryCodes = useCallback(() => {
        setVisibleRecoveryCodes([]);
    }, []);

    const handleLinkProvider = useCallback(async (providerKey, providerLabel, linkProvider) => {
        if (!linkProvider) {
            showMsg('error', t('profile.message.providerLinkUnavailable', { provider: providerLabel }, `${providerLabel} linking is not available in this build.`));
            return;
        }

        setProviderLinking(providerKey);
        try {
            const result = await linkProvider();
            if (result?.redirecting) {
                showMsg('success', t('profile.message.providerLinkRedirect', { provider: providerLabel }, `Complete ${providerLabel} linking in the provider window.`));
                return;
            }

            showMsg('success', result?.alreadyLinked
                ? t('profile.message.providerAlreadyLinked', { provider: providerLabel }, `${providerLabel} is already linked to this account.`)
                : t('profile.message.providerLinked', { provider: providerLabel }, `${providerLabel} linked to this account.`));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.providerLinkFailed', { provider: providerLabel }, `Could not link ${providerLabel}.`));
        } finally {
            setProviderLinking('');
        }
    }, [showMsg, t]);

    const handleLinkMicrosoftProvider = useCallback(() => (
        handleLinkProvider('microsoft', 'Microsoft', linkMicrosoftProvider)
    ), [handleLinkProvider, linkMicrosoftProvider]);

    const handleLinkAppleProvider = useCallback(() => (
        handleLinkProvider('apple', 'Apple', linkAppleProvider)
    ), [handleLinkProvider, linkAppleProvider]);

    return {
        trustStatus,
        trustLoading,
        mfaCenter,
        mfaStatus,
        mfaFlags,
        mfaPolicy,
        mfaCenterLoading,
        mfaCenterLoaded,
        mfaCenterError,
        totpSetup,
        totpSetupCode,
        setTotpSetupCode,
        totpSetupLoading,
        totpVerifyLoading,
        mfaPasskeyWorking,
        trustedDeviceAction,
        activeSessions,
        activeSessionsLoading,
        activeSessionsLoaded,
        activeSessionsError,
        activeSessionAction,
        securityActivity,
        securityActivityPagination,
        securityActivityRetentionDays,
        securityActivityLoading,
        securityActivityLoaded,
        securityActivityError,
        visibleRecoveryCodes,
        recoveryCodesGenerating,
        providerLinking,
        securityActions: {
            refreshTrustStatus,
            refreshMfaCenter,
            refreshActiveSessions,
            refreshSecurityActivity,
            handleGenerateBackupRecoveryCodes,
            handleStartTotpSetup,
            handleVerifyTotpSetup,
            handleRegisterMfaPasskey,
            handleRenameTrustedDevice,
            handleRevokeTrustedDevice,
            handleRevokeOtherTrustedDevices,
            handleRevokeActiveSession,
            handleRevokeOtherActiveSessions,
            handleRevokeAllActiveSessions,
            handleCopyRecoveryCodes,
            handleDownloadRecoveryCodes,
            clearVisibleRecoveryCodes,
            handleLinkMicrosoftProvider,
            handleLinkAppleProvider,
        },
    };
}
