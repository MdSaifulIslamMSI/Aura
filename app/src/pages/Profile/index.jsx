import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    BarChart3,
    Bell,
    CreditCard,
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
import { authApi, paymentApi, trustApi, userApi, intelligenceApi } from '@/services/api';
import { getUserVisibleEmail } from '@/utils/authIdentity';
import { isTrustedDeviceChallengeError } from '@/utils/authStepUp';
import { openStripeSetupModal } from '@/utils/stripe';
import { useActiveWindowRefresh } from '@/hooks/useActiveWindowRefresh';

import OverviewSection from './components/OverviewSection';
import PersonalInfoSection from './components/PersonalInfoSection';
import AddressesSection from './components/AddressesSection';
import OrdersSection from './components/OrdersSection';
import RewardsSection from './components/RewardsSection';
import ListingsSection from './components/ListingsSection';
import PaymentsSection from './components/PaymentsSection';
import AccountStatusBanner from './components/AccountStatusBanner';
import SupportSection from './components/SupportSection';
import NotificationsSection from './components/NotificationsSection';
import AccountCenterShell from './components/AccountCenterShell';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const SettingsSection = lazy(() => import('./components/SettingsSection'));
const PROFILE_FIELDS = ['name', 'phone', 'gender', 'dob', 'bio'];

const normalizeProfileFormForComparison = (value = {}) => ({
    name: trimText(value.name),
    phone: normalizePhone(value.phone),
    gender: trimText(value.gender),
    dob: trimText(value.dob),
    bio: trimText(value.bio),
});

const validateProfileForm = (value = {}, t) => {
    const errors = {};
    const normalized = normalizeProfileFormForComparison(value);
    if (normalized.name.length < 2 || normalized.name.length > 50) {
        errors.name = t('profile.personal.error.name', {}, 'Enter a name between 2 and 50 characters.');
    }
    if (normalized.phone && !PHONE_REGEX.test(normalized.phone)) {
        errors.phone = t('profile.personal.error.phone', {}, 'Enter a valid phone number with 10 to 15 digits.');
    }
    if (normalized.bio.length > 200) {
        errors.bio = t('profile.personal.error.bio', {}, 'Keep your bio to 200 characters or fewer.');
    }
    if (normalized.dob) {
        const date = new Date(normalized.dob);
        if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
            errors.dob = t('profile.personal.error.dob', {}, 'Enter a valid date of birth that is not in the future.');
        }
    }
    return errors;
};

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
        id: 'listings',
        label: t('profile.tab.listings', {}, 'My listings'),
        description: t('profile.tab.listings.description', {}, 'Manage the marketplace listings connected to your seller account.'),
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

const PHONE_REGEX = /^\+?\d{10,15}$/;
const DEFAULT_TRUST_STATUS = {
    backend: { status: 'degraded', db: 'unknown', uptime: 0, timestamp: null },
    client: { online: true, secureContext: false, language: 'unknown', timezone: 'unknown' },
    derivedStatus: 'degraded',
};

const normalizePhone = (phone) => String(phone || '').replace(/[\s\-()]/g, '').trim();
const trimText = (value) => String(value || '').trim();
const isNotFoundError = (error) => Number(error?.status) === 404 || /not found/i.test(String(error?.message || ''));

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
    const [profile, setProfile] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [recoveryLaunching, setRecoveryLaunching] = useState(false);
    const [recoveryCodesGenerating, setRecoveryCodesGenerating] = useState(false);
    const [visibleRecoveryCodes, setVisibleRecoveryCodes] = useState([]);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
    const [netbankingCatalog, setNetbankingCatalog] = useState(null);
    const [netbankingCatalogLoading, setNetbankingCatalogLoading] = useState(false);
    const [rewards, setRewards] = useState(null);
    const [rewardsLoading, setRewardsLoading] = useState(false);
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
    const [intelligenceData, setIntelligenceData] = useState(null);
    const [intelligenceLoading, setIntelligenceLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [providerLinking, setProviderLinking] = useState('');

    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [profileFieldErrors, setProfileFieldErrors] = useState({});
    const [profileSubmitError, setProfileSubmitError] = useState('');
    const [profileRequiresReauth, setProfileRequiresReauth] = useState(false);

    const [showAddressForm, setShowAddressForm] = useState(false);
    const [editingAddress, setEditingAddress] = useState(null);
    const [addressSubmitError, setAddressSubmitError] = useState('');
    const [addressesLoading, setAddressesLoading] = useState(false);
    const [addressesError, setAddressesError] = useState('');
    const [addressForm, setAddressForm] = useState({
        type: 'home',
        name: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        isDefault: false,
    });

    const fileInputRef = useRef(null);
    const editModeRef = useRef(false);
    const tabs = useMemo(() => buildTabs(t), [t]);
    const activeTabDefinition = useMemo(
        () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
        [activeTab, tabs],
    );
    const canUseProtectedProfileApis = Boolean(currentUser?.uid && isAuthenticated);
    const socialAuthStatus = useMemo(() => getFirebaseSocialAuthStatus(), [currentUser?.uid]);
    const linkedProviderIds = useMemo(() => (
        Array.isArray(currentUser?.providerData)
            ? currentUser.providerData.map((entry) => trimText(entry?.providerId)).filter(Boolean)
            : []
    ), [currentUser?.providerData]);

    const createEditForm = useCallback((source = {}) => ({
        name: source?.name || '',
        phone: source?.phone || '',
        gender: source?.gender || '',
        dob: source?.dob ? new Date(source.dob).toISOString().split('T')[0] : '',
        bio: source?.bio || '',
    }), []);

    useEffect(() => {
        editModeRef.current = editMode;
    }, [editMode]);

    const showMsg = useCallback((type, text) => {
        setMessage({ type, text });
        window.setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    }, []);

    const refreshPaymentMethods = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setPaymentMethods([]);
            setPaymentMethodsLoading(false);
            return [];
        }

        if (!silent) {
            setPaymentMethodsLoading(true);
        }
        try {
            const methodsResult = await paymentApi.getMethods();
            const nextMethods = Array.isArray(methodsResult)
                ? methodsResult
                : Array.isArray(methodsResult?.paymentMethods)
                    ? methodsResult.paymentMethods
                    : [];
            setPaymentMethods(nextMethods);
            return nextMethods;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Failed to load payment methods', error);
            }
            setPaymentMethods([]);
            return [];
        } finally {
            if (!silent) {
                setPaymentMethodsLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshNetbankingCatalog = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setNetbankingCatalog(null);
            setNetbankingCatalogLoading(false);
            return null;
        }

        if (!silent) {
            setNetbankingCatalogLoading(true);
        }

        try {
            const catalog = await paymentApi.getNetbankingBanks();
            setNetbankingCatalog(catalog || { banks: [], featuredBanks: [] });
            return catalog;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Failed to load netbanking catalog', error);
            }
            if (!silent) {
                showMsg('error', error.message || t('profile.message.netbankingCatalogFailed', {}, 'Failed to load netbanking banks.'));
            }
            setNetbankingCatalog({ banks: [], featuredBanks: [], stale: true, source: 'unavailable' });
            return null;
        } finally {
            if (!silent) {
                setNetbankingCatalogLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, showMsg, t]);

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

    const refreshIntelligence = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setIntelligenceData(null);
            setIntelligenceLoading(false);
            return null;
        }

        if (!silent) {
            setIntelligenceLoading(true);
        }
        try {
            const nextData = await intelligenceApi.getLatestRewards();
            setIntelligenceData(nextData || null);
        } catch (error) {
            if (!isNotFoundError(error) && !isTrustedDeviceChallengeError(error)) {
                console.error('Intelligence fetch failed:', error);
            }
            setIntelligenceData(null);
        } finally {
            if (!silent) {
                setIntelligenceLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshRewards = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setRewards(null);
            setRewardsLoading(false);
            return null;
        }

        if (!silent) {
            setRewardsLoading(true);
        }

        try {
            const result = await userApi.getRewards();
            setRewards(result?.rewards || result || null);
            return result?.rewards || result || null;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Rewards fetch failed:', error);
            }
            setRewards(null);
            return null;
        } finally {
            if (!silent) {
                setRewardsLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshAddresses = useCallback(async () => {
        if (!canUseProtectedProfileApis) return null;
        setAddressesLoading(true);
        setAddressesError('');
        try {
            const result = await userApi.getAddresses();
            setProfile((previous) => ({
                ...(previous || {}),
                addresses: Array.isArray(result?.addresses) ? result.addresses : [],
            }));
            return result;
        } catch (error) {
            const messageText = error.message || t(
                'profile.addresses.loadError',
                {},
                'Saved addresses could not be loaded.'
            );
            setAddressesError(messageText);
            return null;
        } finally {
            setAddressesLoading(false);
        }
    }, [canUseProtectedProfileApis, t]);

    const refreshProfileDeck = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setProfile(dbUser || null);
            setDashboard(null);
            setLoading(false);
            return null;
        }

        if (!silent) {
            setLoading(true);
        }

        try {
            const [profileData, dashData] = await Promise.all([
                userApi.getProfile({ firebaseUser: currentUser }),
                userApi.getAccountOverview({ firebaseUser: currentUser }),
            ]);

            setProfile(profileData);
            setDashboard(dashData);
            if (!editModeRef.current) {
                setEditForm(createEditForm(profileData));
            }

            return { profileData, dashData };
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Profile fetch failed:', error);
            }
            if (dbUser) {
                setProfile((previous) => ({ ...(previous || {}), ...dbUser }));
                if (!editModeRef.current) {
                    setEditForm(createEditForm(dbUser));
                }
            }
            return null;
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, createEditForm, currentUser, dbUser]);

    useEffect(() => {
        void refreshProfileDeck();
    }, [canUseProtectedProfileApis, refreshProfileDeck]);

    useEffect(() => {
        if (!dbUser) return;
        setProfile((previous) => ({ ...(previous || {}), ...dbUser }));
        setEditForm((previous) => ({
            ...previous,
            name: dbUser.name || previous.name || '',
            phone: dbUser.phone || previous.phone || '',
        }));
    }, [dbUser]);

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
        if (requestedTab && tabs.some((tab) => tab.id === requestedTab)) {
            setActiveTab(requestedTab);
        }
    }, [searchParams, tabs]);

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

    const handleProfileFieldChange = useCallback((field, value) => {
        if (!PROFILE_FIELDS.includes(field)) return;
        setEditForm((previous) => ({ ...previous, [field]: value }));
        setProfileFieldErrors((previous) => {
            if (!previous[field]) return previous;
            const next = { ...previous };
            delete next[field];
            return next;
        });
        setProfileSubmitError('');
        setProfileRequiresReauth(false);
    }, []);

    const handleSaveProfile = async (event) => {
        event?.preventDefault?.();
        if (saving) return;

        const fieldErrors = validateProfileForm(editForm, t);
        if (Object.keys(fieldErrors).length > 0) {
            setProfileFieldErrors(fieldErrors);
            setProfileSubmitError(t('profile.personal.error.reviewFields', {}, 'Review the highlighted fields before saving.'));
            setProfileRequiresReauth(false);
            return;
        }

        const currentForm = normalizeProfileFormForComparison(editForm);
        const baselineForm = normalizeProfileFormForComparison(createEditForm(profile));
        if (JSON.stringify(currentForm) === JSON.stringify(baselineForm)) {
            setProfileSubmitError(t('profile.personal.error.noChanges', {}, 'Make a change before saving.'));
            return;
        }

        setSaving(true);
        setProfileFieldErrors({});
        setProfileSubmitError('');
        setProfileRequiresReauth(false);
        try {
            const payload = {
                ...editForm,
                phone: normalizePhone(editForm.phone),
                bio: trimText(editForm.bio),
                name: trimText(editForm.name),
                ...(Number.isInteger(profile?.version) ? { version: profile.version } : {}),
            };

            const updated = updateProfileInContext
                ? await updateProfileInContext(payload)
                : await userApi.updateProfile(payload);

            setProfile((previous) => ({ ...previous, ...updated }));
            setEditForm(createEditForm({ ...profile, ...updated }));
            setEditMode(false);
            setProfileFieldErrors({});
            setProfileSubmitError('');
            showMsg('success', t('profile.message.profileUpdated', {}, 'Profile updated successfully.'));
        } catch (error) {
            const serverErrors = Array.isArray(error?.data?.errors) ? error.data.errors : [];
            const nextFieldErrors = {};
            serverErrors.forEach((entry) => {
                const field = String(entry?.field || '').split('.').pop();
                if (PROFILE_FIELDS.includes(field)) {
                    nextFieldErrors[field] = entry.message;
                }
            });
            setProfileFieldErrors(nextFieldErrors);
            setProfileSubmitError(error.message || t('profile.message.profileUpdateFailed', {}, 'Failed to update profile.'));
            setProfileRequiresReauth(
                Boolean(editForm.phone !== baselineForm.phone && [401, 403].includes(Number(error?.status || 0)))
            );
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const updated = updateProfileInContext
                    ? await updateProfileInContext({ avatar: reader.result })
                    : await userApi.updateProfile({ avatar: reader.result });
                setProfile((previous) => ({ ...previous, avatar: updated.avatar }));
                showMsg('success', t('profile.message.avatarUpdated', {}, 'Avatar updated.'));
            } catch (error) {
                showMsg('error', error.message || t('profile.message.avatarUpdateFailed', {}, 'Failed to update avatar.'));
            }
        };
        reader.readAsDataURL(file);
    };

    const resetAddressForm = () => {
        setAddressForm({
            type: 'home',
            name: '',
            phone: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
            isDefault: false,
        });
        setEditingAddress(null);
        setAddressSubmitError('');
        setShowAddressForm(false);
    };

    const handleSaveAddress = async () => {
        setSaving(true);
        setAddressSubmitError('');
        try {
            const payload = {
                ...addressForm,
                name: trimText(addressForm.name),
                phone: normalizePhone(addressForm.phone),
                address: trimText(addressForm.address),
                city: trimText(addressForm.city),
                state: trimText(addressForm.state),
                pincode: trimText(addressForm.pincode),
            };

            const result = editingAddress
                ? await userApi.updateAddress(editingAddress, payload)
                : await userApi.addAddress(payload);

            setProfile((previous) => ({ ...previous, addresses: result.addresses }));
            resetAddressForm();
            showMsg('success', editingAddress
                ? t('profile.message.addressUpdated', {}, 'Address updated.')
                : t('profile.message.addressSaved', {}, 'Address saved.'));
        } catch (error) {
            const errorMessage = error.message || t('profile.message.addressSaveFailed', {}, 'Failed to save address.');
            setAddressSubmitError(errorMessage);
            showMsg('error', errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAddress = async (id) => {
        try {
            const result = await userApi.deleteAddress(id);
            setProfile((previous) => ({ ...previous, addresses: result.addresses }));
            showMsg('success', t('profile.message.addressDeleted', {}, 'Address deleted.'));
            return true;
        } catch (error) {
            showMsg('error', error.message || t('profile.message.addressDeleteFailed', {}, 'Failed to delete address.'));
            return false;
        }
    };

    const handleSetDefaultAddress = async (address) => {
        if (!address?._id || address.isDefault || saving) return;
        setSaving(true);
        try {
            const result = await userApi.updateAddress(address._id, {
                type: address.type || 'home',
                name: trimText(address.name),
                phone: normalizePhone(address.phone),
                address: trimText(address.address),
                city: trimText(address.city),
                state: trimText(address.state),
                pincode: trimText(address.pincode),
                isDefault: true,
            });
            setProfile((previous) => ({ ...previous, addresses: result.addresses }));
            showMsg('success', t('profile.message.addressDefaultUpdated', {}, 'Default shipping address updated.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.addressSaveFailed', {}, 'Failed to save address.'));
        } finally {
            setSaving(false);
        }
    };

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

    const handleGenerateBackupRecoveryCodes = async () => {
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
    };

    const handleStartTotpSetup = async () => {
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
    };

    const handleVerifyTotpSetup = async () => {
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
    };

    const handleRegisterMfaPasskey = async () => {
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
        } catch (error) {
            showMsg('error', error.message || t('profile.message.passkeyRegisterFailed', {}, 'Could not register this passkey.'));
        } finally {
            setMfaPasskeyWorking(false);
        }
    };

    const applyTrustedDeviceMutation = async ({ actionKey, operation, successMessage }) => {
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
    };

    const handleRenameTrustedDevice = async (deviceId, label) => {
        if (!renameTrustedDeviceInContext) {
            throw new Error(t('profile.message.trustedDeviceUnavailable', {}, 'Trusted-device management is unavailable in this session.'));
        }
        return applyTrustedDeviceMutation({
            actionKey: `rename:${deviceId}`,
            operation: () => renameTrustedDeviceInContext({ deviceId, label }),
            successMessage: t('profile.message.trustedDeviceRenamed', {}, 'Trusted device renamed.'),
        });
    };

    const handleRevokeTrustedDevice = async (deviceId, { isCurrent = false } = {}) => {
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
    };

    const handleRevokeOtherTrustedDevices = async () => {
        if (!revokeOtherTrustedDevicesInContext) {
            throw new Error(t('profile.message.trustedDeviceUnavailable', {}, 'Trusted-device management is unavailable in this session.'));
        }
        return applyTrustedDeviceMutation({
            actionKey: 'revoke-others',
            operation: () => revokeOtherTrustedDevicesInContext(),
            successMessage: t('profile.message.otherTrustedDevicesRevoked', {}, 'Other trusted devices were revoked.'),
        });
    };

    const handleRevokeActiveSession = async (session) => {
        const sessionId = String(session?.id || '').trim();
        setActiveSessionAction(`revoke:${sessionId}`);
        try {
            const result = await authApi.revokeAccountSession(
                { sessionId },
                { firebaseUser: currentUser }
            );

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
    };

    const handleRevokeOtherActiveSessions = async () => {
        setActiveSessionAction('revoke-others');
        try {
            const result = await authApi.revokeOtherAccountSessions({ firebaseUser: currentUser });
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
    };

    const handleRevokeAllActiveSessions = async () => {
        setActiveSessionAction('revoke-all');
        try {
            const result = await authApi.revokeAllAccountSessions({ firebaseUser: currentUser });
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
    };

    const handleCopyRecoveryCodes = async () => {
        if (!visibleRecoveryCodes.length) return;

        try {
            await navigator.clipboard.writeText(visibleRecoveryCodes.join('\n'));
            showMsg('success', t('profile.message.recoveryCodesCopied', {}, 'Backup recovery codes copied.'));
        } catch {
            showMsg('error', t('profile.message.recoveryCodesCopyFailed', {}, 'Could not copy recovery codes from this browser.'));
        }
    };

    const handleDownloadRecoveryCodes = () => {
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
    };

    const handleSetDefaultMethod = async (methodId) => {
        try {
            await paymentApi.setDefaultMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.defaultPaymentUpdated', {}, 'Default payment method updated.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.defaultPaymentUpdateFailed', {}, 'Failed to update default payment method.'));
        }
    };

    const handleDeletePaymentMethod = async (methodId) => {
        if (!confirm(t('profile.confirm.deletePaymentMethod', {}, 'Are you sure you want to delete this payment method?'))) return;
        try {
            await paymentApi.deleteMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.paymentMethodDeleted', {}, 'Payment method deleted.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.paymentMethodDeleteFailed', {}, 'Failed to delete payment method.'));
        }
    };

    const handleAddStripeCard = async () => {
        try {
            const setup = await paymentApi.createMethodSetupIntent({ provider: 'stripe', type: 'card' });
            const setupIntent = await openStripeSetupModal({
                publishableKey: setup.publishableKey,
                clientSecret: setup.clientSecret,
                title: t('profile.payments.addCard.title', {}, 'Add card'),
                submitLabel: t('profile.payments.addCard.submit', {}, 'Save card'),
                cancelLabel: t('profile.payments.addCard.cancel', {}, 'Cancel'),
            });

            await paymentApi.saveMethod({
                provider: 'stripe',
                type: 'card',
                providerSetupIntentId: setupIntent.id || setup.setupIntentId,
                metadata: {
                    enrollmentSource: 'settings',
                },
            });
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.cardSaved', {}, 'Card saved successfully.'));
        } catch (error) {
            if (/cancelled/i.test(String(error?.message || ''))) return;
            showMsg('error', error.message || t('profile.message.cardSaveFailed', {}, 'Failed to save card.'));
        }
    };

    const handleSaveNetbankingBank = async (bank) => {
        const bankCode = String(bank?.code || '').trim().toUpperCase();
        if (!bankCode) {
            showMsg('error', t('profile.message.bankRequired', {}, 'Choose a netbanking bank to save.'));
            return;
        }

        try {
            await paymentApi.saveMethod({
                provider: 'razorpay',
                type: 'bank',
                providerMethodId: bankCode,
                isDefault: paymentMethods.length === 0,
                metadata: {
                    enrollmentSource: 'settings',
                    bankCode,
                    bankName: bank?.name || bankCode,
                },
            });
            await Promise.all([
                refreshPaymentMethods(),
                refreshNetbankingCatalog({ silent: true }),
            ]);
            showMsg('success', t('profile.message.bankPreferenceSaved', {}, 'NetBanking bank saved.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.bankPreferenceFailed', {}, 'Failed to save netbanking bank.'));
        }
    };

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

    const handleOptimizeRewards = async () => {
        setOptimizing(true);
        try {
            await intelligenceApi.optimizeRewards();
            showMsg('success', t('profile.message.optimizationStarted', {}, 'Aura Intelligence optimization started. Fresh insights will appear shortly.'));
            window.setTimeout(() => {
                void refreshIntelligence({ silent: true });
            }, 6000);
        } catch (error) {
            showMsg('error', error.message || t('profile.message.optimizationFailed', {}, 'Failed to start optimization.'));
        } finally {
            setOptimizing(false);
        }
    };

    const supportLaunch = {
        focusTicketId: String(searchParams.get('ticket') || '').trim(),
        startCompose: searchParams.get('compose') === '1',
        prefill: {
            category: String(searchParams.get('category') || '').trim(),
            relatedActionId: String(searchParams.get('actionId') || '').trim(),
            subject: String(searchParams.get('subject') || '').trim(),
            intent: String(searchParams.get('intent') || '').trim(),
        },
    };

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
    const mfaStatus = mfaCenter?.mfa || profile?.mfa || dbUser?.mfa || null;
    const mfaFlags = mfaCenter?.flags || {};
    const mfaPolicy = mfaCenter?.policy || null;
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
    const profileDirty = useMemo(() => (
        JSON.stringify(normalizeProfileFormForComparison(editForm))
        !== JSON.stringify(normalizeProfileFormForComparison(createEditForm(profile)))
    ), [createEditForm, editForm, profile]);

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
            <div className="min-h-screen profile-theme profile-premium-shell">
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
        <div className="min-h-screen profile-theme profile-premium-shell">
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
                        <PersonalInfoSection
                            profile={profile}
                            profileName={profileName}
                            profileEmail={profileEmail}
                            profilePhone={profilePhone}
                            editMode={editMode}
                            setEditMode={(nextMode) => {
                                setEditMode(nextMode);
                                if (!nextMode) {
                                    setProfileFieldErrors({});
                                    setProfileSubmitError('');
                                    setProfileRequiresReauth(false);
                                }
                            }}
                            editForm={editForm}
                            handleProfileFieldChange={handleProfileFieldChange}
                            saving={saving}
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
                    ) : null}

                    {activeTab === 'addresses' ? (
                        <AddressesSection
                            profile={profile}
                            ADDRESS_TYPES={ADDRESS_TYPES}
                            showAddressForm={showAddressForm}
                            setShowAddressForm={setShowAddressForm}
                            editingAddress={editingAddress}
                            addressForm={addressForm}
                            setAddressForm={setAddressForm}
                            saving={saving}
                            handleSaveAddress={handleSaveAddress}
                            resetAddressForm={resetAddressForm}
                            startEditAddress={(address) => {
                                setAddressForm({
                                    type: address.type || 'home',
                                    name: address.name || '',
                                    phone: address.phone || '',
                                    address: address.address || '',
                                    city: address.city || '',
                                    state: address.state || '',
                                    pincode: address.pincode || '',
                                    isDefault: Boolean(address.isDefault),
                                });
                                setEditingAddress(address._id);
                                setShowAddressForm(true);
                            }}
                            handleDeleteAddress={handleDeleteAddress}
                            handleSetDefaultAddress={handleSetDefaultAddress}
                            addressSubmitError={addressSubmitError}
                            addressesLoading={addressesLoading}
                            addressesError={addressesError}
                            onRetryAddresses={refreshAddresses}
                        />
                    ) : null}

                    {activeTab === 'orders' ? <OrdersSection recentOrders={recentOrders} stats={stats} /> : null}

                    {activeTab === 'rewards' ? (
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
                    ) : null}

                    {activeTab === 'listings' ? <ListingsSection stats={stats} /> : null}

                    {activeTab === 'payments' ? (
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
                    ) : null}

                    {activeTab === 'notifications' ? <NotificationsSection /> : null}

                    {activeTab === 'support' ? (
                        <SupportSection
                            profile={profile}
                            focusTicketId={supportLaunch.focusTicketId}
                            startCompose={supportLaunch.startCompose}
                            prefill={supportLaunch.prefill}
                        />
                    ) : null}

                    {activeTab === 'settings' ? (
                        <Suspense fallback={(
                            <div className="premium-panel p-6 text-sm font-bold text-slate-300" role="status" aria-live="polite">
                                {t('profile.settings.loading', {}, 'Loading security and settings...')}
                            </div>
                        )}>
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
                            handleClearVisibleRecoveryCodes={() => setVisibleRecoveryCodes([])}
                            mfaStatus={mfaStatus}
                            mfaFlags={mfaFlags}
                            mfaPolicy={mfaPolicy}
                            mfaCenterLoading={mfaCenterLoading}
                            mfaCenterLoaded={mfaCenterLoaded}
                            mfaCenterHasData={Boolean(mfaCenter)}
                            mfaCenterError={mfaCenterError}
                            handleRetryMfaCenter={() => refreshMfaCenter()}
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
                            handleRetryActiveSessions={() => refreshActiveSessions()}
                            handleRevokeActiveSession={handleRevokeActiveSession}
                            handleRevokeOtherActiveSessions={handleRevokeOtherActiveSessions}
                            handleRevokeAllActiveSessions={handleRevokeAllActiveSessions}
                            securityActivity={securityActivity}
                            securityActivityLoading={securityActivityLoading}
                            securityActivityLoaded={securityActivityLoaded}
                            securityActivityError={securityActivityError}
                            securityActivityHasMore={securityActivityPagination.hasMore}
                            securityActivityRetentionDays={securityActivityRetentionDays}
                            handleRetrySecurityActivity={() => refreshSecurityActivity()}
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
            </AccountCenterShell>
        </div>
    );
}
