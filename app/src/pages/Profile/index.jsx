import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    BarChart3,
    Bell,
    CreditCard,
    LockKeyhole,
    MapPin,
    Package,
    Settings,
    Shield,
    Sparkles,
    Store,
    User,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { getFirebaseSocialAuthStatus } from '@/config/firebase';
import { getUserVisibleEmail } from '@/utils/authIdentity';
import { useActiveWindowRefresh } from '@/hooks/useActiveWindowRefresh';
import SectionErrorBoundary from '@/components/shared/SectionErrorBoundary';
import {
    ACCOUNT_TELEMETRY_EVENTS,
    initAccountWebVitals,
    trackAccountEvent,
} from '@/services/accountTelemetry';

import OverviewSection from './components/OverviewSection';
import AccountStatusBanner from './components/AccountStatusBanner';
import AccountCenterShell from './components/AccountCenterShell';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import {
    PHONE_REGEX,
    normalizePhone,
    trimText,
    createEditForm,
} from './hooks/profileUtils';
import { useAccountNotice } from './hooks/useAccountNotice';
import { useAddresses } from './hooks/useAddresses';
import { useProfileDeck } from './hooks/useProfileDeck';
import { usePaymentHub } from './hooks/usePaymentHub';
import { useSecurityCenter } from './hooks/useSecurityCenter';

const PersonalInfoSection = lazy(() => import('./components/PersonalInfoSection'));
const AddressesSection = lazy(() => import('./components/AddressesSection'));
const OrdersSection = lazy(() => import('./components/OrdersSection'));
const RewardsSection = lazy(() => import('./components/RewardsSection'));
const PaymentsSection = lazy(() => import('./components/PaymentsSection'));
const SupportSection = lazy(() => import('./components/SupportSection'));
const NotificationsSection = lazy(() => import('./components/NotificationsSection'));
const SettingsSection = lazy(() => import('./components/SettingsSection'));
const MarketplaceActivitySection = lazy(() => import('./components/MarketplaceActivitySection'));
const PrivacyControlsSection = lazy(() => import('./components/PrivacyControlsSection'));

const buildTabs = (t) => [
    {
        id: 'overview',
        label: t('profile.tab.overview', {}, 'Overview'),
        description: t('profile.tab.overview.description', {}, 'See the account details and recent activity that need your attention.'),
        icon: BarChart3,
    },
    {
        id: 'personal',
        label: t('profile.tab.personal', {}, 'Personal information'),
        description: t('profile.tab.personal.description', {}, 'Manage your profile details and verified contact information.'),
        icon: User,
    },
    {
        id: 'addresses',
        label: t('profile.tab.addresses', {}, 'Addresses'),
        description: t('profile.tab.addresses.description', {}, 'Keep delivery and billing addresses accurate for checkout.'),
        icon: MapPin,
    },
    {
        id: 'orders',
        label: t('profile.tab.orders', {}, 'Orders'),
        description: t('profile.tab.orders.description', {}, 'Review recent purchases and continue order-related tasks.'),
        icon: Package,
    },
    {
        id: 'rewards',
        label: t('profile.tab.rewards', {}, 'Aura points'),
        description: t('profile.tab.rewards.description', {}, 'Review your balance, tier, and recent rewards activity.'),
        icon: Sparkles,
    },
    {
        id: 'marketplace',
        label: t('profile.tab.marketplace', {}, 'Saved & marketplace'),
        description: t('profile.tab.marketplace.description', {}, 'Manage saved products, reviews, listings, trade-ins, and price alerts.'),
        icon: Store,
    },
    {
        id: 'payments',
        label: t('profile.tab.payments', {}, 'Payments'),
        description: t('profile.tab.payments.description', {}, 'Review saved payment methods and account payment preferences.'),
        icon: CreditCard,
    },
    {
        id: 'notifications',
        label: t('profile.tab.notifications', {}, 'Notifications'),
        description: t('profile.tab.notifications.description', {}, 'Read account, order, marketplace, and support updates.'),
        icon: Bell,
    },
    {
        id: 'support',
        label: t('profile.tab.support', {}, 'Support'),
        description: t('profile.tab.support.description', {}, 'Open and follow account appeals or support requests.'),
        icon: Shield,
    },
    {
        id: 'privacy',
        label: t('profile.tab.privacy', {}, 'Privacy controls'),
        description: t('profile.tab.privacy.description', {}, 'Review data export and controlled account lifecycle options.'),
        icon: LockKeyhole,
    },
    {
        id: 'settings',
        label: t('profile.tab.settings', {}, 'Security & settings'),
        description: t('profile.tab.settings.description', {}, 'Manage sign-in protection, trusted credentials, recovery, and account preferences.'),
        icon: Settings,
    },
];

const ADDRESS_TYPES = [
    { value: 'home', label: 'Home', icon: MapPin },
    { value: 'work', label: 'Work', icon: MapPin },
    { value: 'other', label: 'Other', icon: MapPin },
];

const AccountSectionFallback = ({ message }) => (
    <div className="account-section-fallback premium-panel p-6" role="status" aria-live="polite">
        <span className="account-section-fallback__line" aria-hidden="true" />
        <span className="account-section-fallback__line account-section-fallback__line--short" aria-hidden="true" />
        <span className="sr-only">{message}</span>
    </div>
);

export default function Profile() {
    const {
        currentUser,
        dbUser,
        logout,
        sessionIntelligence,
        linkMicrosoftProvider,
        linkAppleProvider,
        updateProfile: updateProfileInContext,
        generateRecoveryCodes,
        startTotpSetup,
        verifyTotpSetup,
        registerMfaPasskey,
        renameTrustedDevice: renameTrustedDeviceInContext,
        revokeTrustedDevice: revokeTrustedDeviceInContext,
        revokeOtherTrustedDevices: revokeOtherTrustedDevicesInContext,
        regenerateMfaRecoveryCodes,
        isAuthenticated,
    } = useContext(AuthContext);
    const { t: legacyT, formatDateTime, formatNumber } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const [activeTab, setActiveTab] = useState('overview');
    const [isOnline, setIsOnline] = useState(() => (
        typeof navigator === 'undefined' || navigator.onLine !== false
    ));
    const { message, showMsg } = useAccountNotice();
    const {
        profile,
        setProfile,
        dashboard,
        loading,
        profileSaving,
        avatarUploading,
        editMode,
        handleEditModeChange,
        editForm,
        handleProfileFieldChange,
        handleSaveProfile,
        handleAvatarChange,
        profileDirty,
        profileFieldErrors,
        profileSubmitError,
        profileRequiresReauth,
        fileInputRef,
        refreshProfileDeck,
    } = useProfileDeck({
        canUseProtectedProfileApis: Boolean(currentUser?.uid && isAuthenticated),
        currentUser,
        dbUser,
        showMsg,
        t,
        updateProfileInContext,
    });
    const [recoveryLaunching, setRecoveryLaunching] = useState(false);
    const {
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
        securityActions,
    } = useSecurityCenter({
        canUseProtectedProfileApis: Boolean(currentUser?.uid && isAuthenticated),
        currentUser,
        dbUser,
        profile,
        sessionIntelligence,
        showMsg,
        t,
        logout,
        navigate,
        refreshProfileDeck,
        contextFns: {
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
        },
    });
    const {
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
    } = securityActions;

    const canUseProtectedProfileApis = Boolean(currentUser?.uid && isAuthenticated);
    const {
        showAddressForm,
        setShowAddressForm,
        editingAddress,
        addressForm,
        setAddressForm,
        addressSaving,
        addressSubmitError,
        addressesLoading,
        addressesError,
        addressActions,
    } = useAddresses({
        canUseProtectedProfileApis,
        showMsg,
        t,
        setProfile,
    });
    const {
        paymentMethods,
        paymentMethodsLoading,
        netbankingCatalog,
        netbankingCatalogLoading,
        rewards,
        rewardsLoading,
        intelligenceData,
        intelligenceLoading,
        optimizing,
        paymentHubActions,
    } = usePaymentHub({
        canUseProtectedProfileApis,
        showMsg,
        t,
    });

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const markOnline = () => setIsOnline(true);
        const markOffline = () => setIsOnline(false);
        window.addEventListener('online', markOnline);
        window.addEventListener('offline', markOffline);
        return () => {
            window.removeEventListener('online', markOnline);
            window.removeEventListener('offline', markOffline);
        };
    }, []);
    useEffect(() => initAccountWebVitals(), []);
    useEffect(() => {
        trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.SECTION_VIEWED, {
            section: activeTab,
        });
    }, [activeTab]);
    const tabs = useMemo(() => buildTabs(t), [t]);
    const activeTabDefinition = useMemo(
        () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
        [activeTab, tabs],
    );
    const socialAuthStatus = useMemo(() => getFirebaseSocialAuthStatus(), [currentUser?.uid]);
    const linkedProviderIds = useMemo(() => (
        Array.isArray(currentUser?.providerData)
            ? currentUser.providerData.map((entry) => trimText(entry?.providerId)).filter(Boolean)
            : []
    ), [currentUser?.providerData]);

    const {
        refreshPaymentMethods,
        refreshNetbankingCatalog,
        refreshIntelligence,
        refreshRewards,
    } = paymentHubActions;

    const { refreshAddresses } = addressActions;

    useEffect(() => {
        if (!['payments', 'settings'].includes(activeTab)) return;
        void refreshPaymentMethods();
    }, [activeTab, canUseProtectedProfileApis, refreshPaymentMethods]);

    useEffect(() => {
        if (activeTab !== 'payments' || !canUseProtectedProfileApis || netbankingCatalog) return;
        void refreshNetbankingCatalog({ silent: true });
    }, [activeTab, canUseProtectedProfileApis, netbankingCatalog, refreshNetbankingCatalog]);

    useEffect(() => {
        if (activeTab !== 'rewards') return;
        void refreshRewards();
    }, [activeTab, canUseProtectedProfileApis, refreshRewards]);

    useEffect(() => {
        if (activeTab !== 'addresses') return;
        void refreshAddresses();
    }, [activeTab, refreshAddresses]);

    useEffect(() => {
        if (activeTab !== 'settings') return;
        void refreshTrustStatus();
    }, [activeTab, canUseProtectedProfileApis, refreshTrustStatus]);

    useEffect(() => {
        if (activeTab !== 'settings') return;
        void Promise.all([
            refreshMfaCenter(),
            refreshActiveSessions(),
            refreshSecurityActivity(),
        ]);
    }, [activeTab, canUseProtectedProfileApis, refreshActiveSessions, refreshMfaCenter, refreshSecurityActivity]);

    useEffect(() => {
        if (activeTab !== 'rewards') return;
        void refreshIntelligence();
    }, [activeTab, canUseProtectedProfileApis, refreshIntelligence]);

    useActiveWindowRefresh(
        () => Promise.all([
            refreshProfileDeck({ silent: true }),
            ['payments', 'settings'].includes(activeTab)
                ? refreshPaymentMethods({ silent: true })
                : Promise.resolve(null),
            activeTab === 'payments' ? refreshNetbankingCatalog({ silent: true }) : Promise.resolve(null),
            activeTab === 'rewards'
                ? refreshRewards({ silent: true })
                : Promise.resolve(null),
            activeTab === 'settings'
                ? refreshTrustStatus({ silent: true })
                : Promise.resolve(null),
            activeTab === 'settings'
                ? Promise.all([
                    refreshMfaCenter({ silent: true }),
                    refreshActiveSessions({ silent: true }),
                    refreshSecurityActivity({ silent: true }),
                ])
                : Promise.resolve(null),
            activeTab === 'rewards' ? refreshIntelligence({ silent: true }) : Promise.resolve(null),
        ]),
        {
            enabled: canUseProtectedProfileApis,
            intervalMs: 45 * 1000,
        }
    );

    useEffect(() => {
        const requestedTab = String(searchParams.get('tab') || '').trim();
        const normalizedTab = requestedTab === 'listings' ? 'marketplace' : requestedTab;
        if (!normalizedTab) return;
        if (tabs.some((tab) => tab.id === normalizedTab)) {
            setActiveTab((previous) => (previous === normalizedTab ? previous : normalizedTab));
            return;
        }
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', activeTab);
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, tabs, activeTab, setSearchParams]);

    const handleTabChange = useCallback((tabId) => {
        setActiveTab(tabId);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', tabId);
        if (tabId !== 'support') {
            nextParams.delete('ticket');
            nextParams.delete('compose');
            nextParams.delete('category');
            nextParams.delete('actionId');
            nextParams.delete('subject');
            nextParams.delete('intent');
        }
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const {
        resetAddressForm,
        handleSaveAddress,
        handleDeleteAddress,
        handleSetDefaultAddress,
    } = addressActions;

    const handleSecureRecovery = async () => {
        const recoveryEmail = String(profileEmail || '').trim().toLowerCase();
        const recoveryPhone = normalizedProfilePhone;

        if (!recoveryEmail || !PHONE_REGEX.test(recoveryPhone) || !hasOtpReadyIdentity) {
            showMsg('error', t('profile.message.secureRecoveryRequirements', {}, 'Secure recovery requires the verified account email and registered phone number.'));
            return;
        }

        setRecoveryLaunching(true);

        try {
            await logout();
            navigate('/login', {
                replace: true,
                state: {
                    authMode: 'forgot-password',
                    authPrefill: {
                        email: recoveryEmail,
                        phone: recoveryPhone,
                    },
                    from: `${location.pathname}${location.search}`,
                },
            });
            return;
        } catch (error) {
            showMsg('error', error.message || t('profile.message.secureRecoveryFailed', {}, 'Failed to open secure recovery.'));
        }

        setRecoveryLaunching(false);
    };

    const {
        handleSetDefaultMethod,
        handleDeletePaymentMethod,
        handleAddStripeCard,
        handleSaveNetbankingBank,
        handleOptimizeRewards,
    } = paymentHubActions;

    const supportLaunch = useMemo(() => ({
        focusTicketId: String(searchParams.get('ticket') || '').trim(),
        startCompose: searchParams.get('compose') === '1',
        prefill: {
            category: String(searchParams.get('category') || '').trim(),
            relatedActionId: String(searchParams.get('actionId') || '').trim(),
            subject: String(searchParams.get('subject') || '').trim(),
            intent: String(searchParams.get('intent') || '').trim(),
        },
    }), [searchParams]);

    const accountOverview = dashboard || {};
    const stats = {
        activeOrders: Number(accountOverview?.orders?.activeCount || 0),
        pendingPostPurchase: Number(accountOverview?.postPurchase?.pendingCount || 0),
        savedItems: Number(accountOverview?.savedItems?.count || 0),
        openSupport: Number(accountOverview?.support?.openCount || 0),
        securityActions: Array.isArray(accountOverview?.security?.recommendationCodes)
            ? accountOverview.security.recommendationCodes.length
            : 0,
        listings: {
            active: Number(accountOverview?.marketplace?.activeCount || 0),
            sold: Number(accountOverview?.marketplace?.soldCount || 0),
            totalViews: Number(accountOverview?.marketplace?.recent?.views || 0),
        },
    };
    const recentOrders = (Array.isArray(accountOverview?.orders?.recent)
        ? accountOverview.orders.recent
        : []
    ).map((order) => ({
        _id: order.id,
        orderStatus: order.status,
        isPaid: order.paid,
        isDelivered: order.delivered,
        totalPrice: Number(order.total?.amount || 0),
        presentmentCurrency: order.total?.currency || 'INR',
        createdAt: order.createdAt,
        orderItems: order.item ? [{
            title: order.item.title,
            image: order.item.image,
        }] : [],
    }));
    const rewardSnapshot = rewards || stats.rewards || profile?.loyalty || {};
    const rewardActivity = Array.isArray(rewards?.recentActivity)
        ? rewards.recentActivity
        : Array.isArray(profile?.loyalty?.ledger)
            ? profile.loyalty.ledger.slice(0, 20)
            : [];
    const auraPoints = Number(rewardSnapshot.pointsBalance || 0);
    const auraTier = rewardSnapshot.tier || t('profile.rewardTier.rookie', {}, 'Rookie');
    const nextMilestone = rewardSnapshot.nextMilestone === null ? null : Number(rewardSnapshot.nextMilestone || 0);
    const profileName = profile?.name || dbUser?.name || currentUser?.displayName || t('profile.memberFallback', {}, 'Aura Member');
    const profileEmail = getUserVisibleEmail(profile?.email || dbUser?.email || currentUser?.email || '');
    const profilePhone = profile?.phone || dbUser?.phone || '';
    const initials = (profileName || 'U')
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    const memberSince = profile?.createdAt
        ? formatDateTime(profile.createdAt, undefined, { month: 'long', year: 'numeric' })
        : t('profile.memberSince.recent', {}, 'Recently joined');
    const normalizedProfilePhone = normalizePhone(profilePhone);
    const hasValidProfilePhone = PHONE_REGEX.test(normalizedProfilePhone);
    const hasOtpReadyIdentity = Boolean((profile?.isVerified || currentUser?.emailVerified) && hasValidProfilePhone);
    const paymentMethodsSecured = paymentMethods.length > 0 && paymentMethods.some((method) => method.isDefault);
    const trustHealthy = activeTab === 'settings'
        ? trustStatus.derivedStatus === 'healthy'
        : !accountOverview?.security?.attentionRequired;
    const isAdminAccount = Boolean(profile?.isAdmin || dbUser?.isAdmin);
    const accountState = profile?.accountState || 'active';
    const recoveryReadiness = sessionIntelligence?.readiness || {};
    const mfaMethods = mfaStatus?.methods || {};
    const hasTotp = Boolean(mfaMethods?.totp?.enabled || profile?.mfa?.totp?.enabled || dbUser?.mfa?.totp?.enabled);
    const mfaPasskeyCount = Number(mfaMethods?.passkey?.count || 0);
    const mfaRecoveryCodesActiveCount = Number(
        mfaMethods?.recoveryCodes?.activeCount
        ?? recoveryReadiness.recoveryCodesActiveCount
        ?? 0
    );
    const recoveryCodesActiveCount = mfaRecoveryCodesActiveCount;
    const hasPasskey = Boolean(recoveryReadiness.hasPasskey);
    const hasMfaFactor = Boolean(hasPasskey || hasTotp || mfaStatus?.enabled || mfaPasskeyCount > 0);
    const shouldEnrollRecoveryCodes = Boolean(hasMfaFactor && recoveryCodesActiveCount <= 0);
    const passkeyRecoveryReady = recoveryReadiness.passkeyRecoveryReady !== false;
    const profileCompletion = useMemo(() => {
        const checklist = [
            Boolean(profileName),
            Boolean(profileEmail),
            hasValidProfilePhone,
            Boolean(profile?.avatar),
            Boolean(trimText(profile?.bio)),
            Boolean(profile?.dob),
            Array.isArray(profile?.addresses) && profile.addresses.length > 0,
            Boolean(profile?.isVerified || currentUser?.emailVerified),
        ];
        return Math.round((checklist.filter(Boolean).length / checklist.length) * 100);
    }, [currentUser?.emailVerified, hasValidProfilePhone, profile, profileEmail, profileName]);

    const heroMetrics = [
        {
            label: t('profile.heroMetric.orders.label', {}, 'Orders'),
            value: formatNumber(stats.activeOrders),
            detail: t('profile.heroMetric.orders.detail', {}, 'Currently active'),
        },
        {
            label: t('profile.heroMetric.wishlist.label', {}, 'Saved items'),
            value: formatNumber(stats.savedItems),
            detail: t('profile.heroMetric.wishlist.detail', {}, 'In your wishlist'),
        },
        {
            label: t('profile.heroMetric.listings.label', {}, 'Active listings'),
            value: formatNumber(stats.listings?.active || 0),
            detail: t('profile.heroMetric.listings.detail', {}, 'Currently in the marketplace'),
        },
        {
            label: t('profile.heroMetric.points.label', {}, 'Aura points'),
            value: formatNumber(auraPoints),
            detail: t('profile.heroMetric.points.detail', { tier: auraTier }, `${auraTier} tier`),
        },
    ];

    const accountStateLabelMap = {
        active: t('profile.accountState.active', {}, 'active'),
        warned: t('profile.accountState.warned', {}, 'warned'),
        suspended: t('profile.accountState.suspended', {}, 'suspended'),
        deleted: t('profile.accountState.deleted', {}, 'deleted'),
    };

    if (loading) {
        return (
            <div className="account-center-experience min-h-screen profile-theme profile-premium-shell">
                <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8" role="status" aria-live="polite">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                        <span className="text-xs font-black uppercase tracking-[0.18em] text-[#d2a96c]">
                            {t('profile.loading.kicker', {}, 'Aura account center')}
                        </span>
                        <h1 className="mt-2 text-2xl font-black text-white">{t('profile.loading.title', {}, 'Preparing your account')}</h1>
                        <p className="mt-2 text-sm text-slate-400">{t('profile.loading.body', {}, 'Loading your profile and account summary. This may take a few seconds.')}</p>
                        <div className="mt-6 grid gap-3" aria-hidden="true">
                            <span className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none" />
                            <span className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none" />
                            <span className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="account-center-experience min-h-screen profile-theme profile-premium-shell">
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
            />
            <AccountCenterShell
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                profile={{
                    name: profileName,
                    email: profileEmail,
                    avatar: profile?.avatar,
                    initials,
                }}
                pageTitle={activeTabDefinition.label}
                pageDescription={activeTabDefinition.description}
                memberSince={memberSince}
                profileCompletion={profileCompletion}
                accountState={accountState}
                accountStateLabel={accountStateLabelMap[accountState] || String(accountState).replace(/_/g, ' ')}
                overviewMetrics={heroMetrics}
                onAvatarClick={() => fileInputRef.current?.click()}
                avatarUploading={avatarUploading}
                isOnline={isOnline}
                banner={<AccountStatusBanner accountState={profile?.accountState} moderation={profile?.moderation} />}
                notice={message.text ? (
                    <div
                        className="account-center-notice"
                        data-tone={message.type === 'success' ? 'success' : 'error'}
                        role={message.type === 'success' ? 'status' : 'alert'}
                    >
                        {message.type === 'success'
                            ? <Sparkles className="h-4 w-4" aria-hidden="true" />
                            : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                        <span>{message.text}</span>
                    </div>
                ) : null}
            >

                <SectionErrorBoundary
                    key={activeTab}
                    label={activeTabDefinition.label}
                    retryLabel={t('profile.accountCenter.retrySection', {}, 'Retry section')}
                >
                <div className="py-8">
                    {activeTab === 'overview' ? (
                        <OverviewSection
                            stats={stats}
                            recentOrders={recentOrders}
                            auraPoints={auraPoints}
                            isAdminAccount={isAdminAccount}
                            profile={profile}
                            memberSince={memberSince}
                            hasOtpReadyIdentity={hasOtpReadyIdentity}
                            trustHealthy={trustHealthy}
                            profileCompletion={profileCompletion}
                            overviewMeta={accountOverview?.meta}
                            onRefresh={() => refreshProfileDeck()}
                        />
                    ) : null}

                    {activeTab === 'personal' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <PersonalInfoSection
                                profile={profile}
                                profileName={profileName}
                                profileEmail={profileEmail}
                                profilePhone={profilePhone}
                                editMode={editMode}
                                setEditMode={handleEditModeChange}
                                editForm={editForm}
                                handleProfileFieldChange={handleProfileFieldChange}
                                saving={profileSaving}
                                handleSaveProfile={handleSaveProfile}
                                createEditForm={createEditForm}
                                profileDirty={profileDirty}
                                profileFieldErrors={profileFieldErrors}
                                profileSubmitError={profileSubmitError}
                                profileRequiresReauth={profileRequiresReauth}
                                onReauthenticate={handleSecureRecovery}
                                memberSince={memberSince}
                                hasOtpReadyIdentity={hasOtpReadyIdentity}
                                paymentMethodsSecured={paymentMethodsSecured}
                                trustHealthy={trustHealthy}
                                profileCompletion={profileCompletion}
                                isAdminAccount={isAdminAccount}
                                accountState={accountState}
                            />
                        </Suspense>
                    ) : null}

                    {activeTab === 'addresses' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <AddressesSection
                                profile={profile}
                                ADDRESS_TYPES={ADDRESS_TYPES}
                                showAddressForm={showAddressForm}
                                setShowAddressForm={setShowAddressForm}
                                editingAddress={editingAddress}
                                addressForm={addressForm}
                                setAddressForm={setAddressForm}
                                saving={addressSaving}
                                handleSaveAddress={handleSaveAddress}
                                resetAddressForm={resetAddressForm}
                                startEditAddress={addressActions.startEditAddress}
                                handleDeleteAddress={handleDeleteAddress}
                                handleSetDefaultAddress={handleSetDefaultAddress}
                                addressSubmitError={addressSubmitError}
                                addressesLoading={addressesLoading}
                                addressesError={addressesError}
                                onRetryAddresses={refreshAddresses}
                            />
                        </Suspense>
                    ) : null}

                    {activeTab === 'orders' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <OrdersSection recentOrders={recentOrders} stats={stats} />
                        </Suspense>
                    ) : null}

                    {activeTab === 'rewards' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <RewardsSection
                                auraTier={auraTier}
                                auraPoints={auraPoints}
                                rewardSnapshot={rewardSnapshot}
                                nextMilestone={nextMilestone}
                                handleOptimizeRewards={handleOptimizeRewards}
                                optimizing={optimizing}
                                intelligenceLoading={intelligenceLoading}
                                intelligenceData={intelligenceData}
                                rewardActivity={rewardActivity}
                                rewardsLoading={rewardsLoading}
                            />
                        </Suspense>
                    ) : null}

                    {activeTab === 'marketplace' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.marketplace.loading', {}, 'Loading your saved items and marketplace activity...')} />}>
                            <MarketplaceActivitySection firebaseUser={currentUser} />
                        </Suspense>
                    ) : null}

                    {activeTab === 'payments' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <PaymentsSection
                                paymentMethodsLoading={paymentMethodsLoading}
                                paymentMethods={paymentMethods}
                                recentOrders={recentOrders}
                                netbankingCatalog={netbankingCatalog}
                                netbankingCatalogLoading={netbankingCatalogLoading}
                                handleAddStripeCard={handleAddStripeCard}
                                handleSaveNetbankingBank={handleSaveNetbankingBank}
                                refreshNetbankingCatalog={refreshNetbankingCatalog}
                                handleSetDefaultMethod={handleSetDefaultMethod}
                                handleDeletePaymentMethod={handleDeletePaymentMethod}
                            />
                        </Suspense>
                    ) : null}

                    {activeTab === 'notifications' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <NotificationsSection />
                        </Suspense>
                    ) : null}

                    {activeTab === 'support' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.accountCenter.sectionLoading', {}, 'Loading account section...')} />}>
                            <SupportSection
                                profile={profile}
                                focusTicketId={supportLaunch.focusTicketId}
                                startCompose={supportLaunch.startCompose}
                                prefill={supportLaunch.prefill}
                            />
                        </Suspense>
                    ) : null}

                    {activeTab === 'privacy' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.privacy.loading', {}, 'Loading privacy controls...')} />}>
                            <PrivacyControlsSection firebaseUser={currentUser} />
                        </Suspense>
                    ) : null}

                    {activeTab === 'settings' ? (
                        <Suspense fallback={<AccountSectionFallback message={t('profile.settings.loading', {}, 'Loading security and settings...')} />}>
                            <SettingsSection
                            handleSecureRecovery={handleSecureRecovery}
                            recoveryLaunching={recoveryLaunching}
                            canStartSecureRecovery={Boolean(profileEmail && hasOtpReadyIdentity)}
                            hasOtpReadyIdentity={hasOtpReadyIdentity}
                            trustHealthy={trustHealthy}
                            trustLoading={trustLoading}
                            paymentMethodsSecured={paymentMethodsSecured}
                            paymentMethodCount={paymentMethods.length}
                            trustStatus={trustStatus}
                            logout={logout}
                            memberSince={memberSince}
                            hasPasskey={hasPasskey}
                            shouldEnrollRecoveryCodes={shouldEnrollRecoveryCodes}
                            passkeyRecoveryReady={passkeyRecoveryReady}
                            recoveryCodesActiveCount={recoveryCodesActiveCount}
                            recoveryCodes={visibleRecoveryCodes}
                            recoveryCodesGenerating={recoveryCodesGenerating}
                            handleGenerateRecoveryCodes={handleGenerateBackupRecoveryCodes}
                            handleCopyRecoveryCodes={handleCopyRecoveryCodes}
                            handleDownloadRecoveryCodes={handleDownloadRecoveryCodes}
                            handleClearVisibleRecoveryCodes={clearVisibleRecoveryCodes}
                            mfaStatus={mfaStatus}
                            mfaFlags={mfaFlags}
                            mfaPolicy={mfaPolicy}
                            mfaCenterLoading={mfaCenterLoading}
                            mfaCenterLoaded={mfaCenterLoaded}
                            mfaCenterHasData={Boolean(mfaCenter)}
                            mfaCenterError={mfaCenterError}
                            handleRetryMfaCenter={refreshMfaCenter}
                            totpSetup={totpSetup}
                            totpSetupCode={totpSetupCode}
                            setTotpSetupCode={setTotpSetupCode}
                            totpSetupLoading={totpSetupLoading}
                            totpVerifyLoading={totpVerifyLoading}
                            handleStartTotpSetup={handleStartTotpSetup}
                            handleVerifyTotpSetup={handleVerifyTotpSetup}
                            mfaPasskeyWorking={mfaPasskeyWorking}
                            handleRegisterMfaPasskey={handleRegisterMfaPasskey}
                            trustedDeviceAction={trustedDeviceAction}
                            handleRenameTrustedDevice={handleRenameTrustedDevice}
                            handleRevokeTrustedDevice={handleRevokeTrustedDevice}
                            handleRevokeOtherTrustedDevices={handleRevokeOtherTrustedDevices}
                            activeSessions={activeSessions}
                            activeSessionsLoading={activeSessionsLoading}
                            activeSessionsLoaded={activeSessionsLoaded}
                            activeSessionsError={activeSessionsError}
                            activeSessionAction={activeSessionAction}
                            handleRetryActiveSessions={refreshActiveSessions}
                            handleRevokeActiveSession={handleRevokeActiveSession}
                            handleRevokeOtherActiveSessions={handleRevokeOtherActiveSessions}
                            handleRevokeAllActiveSessions={handleRevokeAllActiveSessions}
                            securityActivity={securityActivity}
                            securityActivityLoading={securityActivityLoading}
                            securityActivityLoaded={securityActivityLoaded}
                            securityActivityError={securityActivityError}
                            securityActivityHasMore={securityActivityPagination.hasMore}
                            securityActivityRetentionDays={securityActivityRetentionDays}
                            handleRetrySecurityActivity={refreshSecurityActivity}
                            handleLoadMoreSecurityActivity={() => refreshSecurityActivity({
                                append: true,
                                cursor: securityActivityPagination.nextCursor,
                            })}
                            linkedProviderIds={linkedProviderIds}
                            socialAuthStatus={socialAuthStatus}
                            providerLinking={providerLinking}
                            handleLinkMicrosoftProvider={handleLinkMicrosoftProvider}
                            handleLinkAppleProvider={handleLinkAppleProvider}
                            />
                        </Suspense>
                    ) : null}
                </div>
                </SectionErrorBoundary>
            </AccountCenterShell>
        </div>
    );
}
