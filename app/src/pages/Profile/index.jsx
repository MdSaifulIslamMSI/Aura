import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    BarChart3,
    Bell,
    Camera,
    Calendar,
    CreditCard,
    Edit3,
    MapPin,
    Package,
    Settings,
    Shield,
    Sparkles,
    Star,
    Store,
    User,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { paymentApi, trustApi, userApi, intelligenceApi } from '@/services/api';
import { cn } from '@/lib/utils';

import OverviewSection from './components/OverviewSection';
import PersonalInfoSection from './components/PersonalInfoSection';
import AddressesSection from './components/AddressesSection';
import OrdersSection from './components/OrdersSection';
import RewardsSection from './components/RewardsSection';
import ListingsSection from './components/ListingsSection';
import PaymentsSection from './components/PaymentsSection';
import SettingsSection from './components/SettingsSection';
import AccountStatusBanner from './components/AccountStatusBanner';
import SupportSection from './components/SupportSection';
import NotificationsSection from './components/NotificationsSection';

const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'personal', label: 'Personal Info', icon: User },
    { id: 'addresses', label: 'Addresses', icon: MapPin },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'rewards', label: 'Aura Points', icon: Sparkles },
    { id: 'listings', label: 'My Listings', icon: Store },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'support', label: 'Appeals & Support', icon: Shield },
    { id: 'settings', label: 'Settings', icon: Settings },
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
    const { currentUser, dbUser, logout, updateProfile: updateProfileInContext } = useContext(AuthContext);
    const { cartItems } = useContext(CartContext);
    const { wishlistItems } = useContext(WishlistContext);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const [activeTab, setActiveTab] = useState('overview');
    const [profile, setProfile] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [recoveryLaunching, setRecoveryLaunching] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
    const [rewards, setRewards] = useState(null);
    const [rewardsLoading, setRewardsLoading] = useState(false);
    const [trustStatus, setTrustStatus] = useState(DEFAULT_TRUST_STATUS);
    const [trustLoading, setTrustLoading] = useState(false);
    const [intelligenceData, setIntelligenceData] = useState(null);
    const [intelligenceLoading, setIntelligenceLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);

    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState({});

    const [showAddressForm, setShowAddressForm] = useState(false);
    const [editingAddress, setEditingAddress] = useState(null);
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

    const createEditForm = (source = {}) => ({
        name: source.name || '',
        phone: source.phone || '',
        gender: source.gender || '',
        dob: source.dob ? new Date(source.dob).toISOString().split('T')[0] : '',
        bio: source.bio || '',
    });

    const showMsg = useCallback((type, text) => {
        setMessage({ type, text });
        window.setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    }, []);

    const refreshPaymentMethods = useCallback(async () => {
        setPaymentMethodsLoading(true);
        try {
            const methodsResult = await paymentApi.getMethods();
            const nextMethods = Array.isArray(methodsResult)
                ? methodsResult
                : Array.isArray(methodsResult?.paymentMethods)
                    ? methodsResult.paymentMethods
                    : [];
            setPaymentMethods(nextMethods);
        } catch (error) {
            console.error('Failed to load payment methods', error);
        } finally {
            setPaymentMethodsLoading(false);
        }
    }, []);

    const refreshTrustStatus = useCallback(async ({ silent = false } = {}) => {
        if (!silent) {
            setTrustLoading(true);
        }
        try {
            const nextStatus = await trustApi.getHealthStatus();
            setTrustStatus(nextStatus || DEFAULT_TRUST_STATUS);
        } catch (error) {
            console.error('Trust status fetch failed:', error);
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
    }, []);

    const refreshIntelligence = useCallback(async ({ silent = false } = {}) => {
        if (!silent) {
            setIntelligenceLoading(true);
        }
        try {
            const nextData = await intelligenceApi.getLatestRewards();
            setIntelligenceData(nextData || null);
        } catch (error) {
            if (!isNotFoundError(error)) {
                console.error('Intelligence fetch failed:', error);
            }
            setIntelligenceData(null);
        } finally {
            if (!silent) {
                setIntelligenceLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!currentUser?.email) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [profileData, dashData] = await Promise.all([
                    userApi.getProfile({ firebaseUser: currentUser }),
                    userApi.getDashboard(),
                ]);

                if (cancelled) return;
                setProfile(profileData);
                setDashboard(dashData);
                setEditForm(createEditForm(profileData));
            } catch (error) {
                console.error('Profile fetch failed:', error);
                if (!cancelled && dbUser?.email) {
                    setProfile((previous) => ({ ...(previous || {}), ...dbUser }));
                    setEditForm(createEditForm(dbUser));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser, dbUser]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!currentUser?.uid) return;
        void refreshPaymentMethods();
    }, [currentUser?.uid, refreshPaymentMethods]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        let cancelled = false;

        (async () => {
            setRewardsLoading(true);
            try {
                const result = await userApi.getRewards();
                if (!cancelled) {
                    setRewards(result?.rewards || result || null);
                }
            } catch (error) {
                console.error('Rewards fetch failed:', error);
                if (!cancelled) {
                    setRewards(null);
                }
            } finally {
                if (!cancelled) {
                    setRewardsLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.uid]);

    useEffect(() => {
        if (!currentUser?.uid) return undefined;

        void refreshTrustStatus();
        const timer = window.setInterval(() => {
            void refreshTrustStatus({ silent: true });
        }, 60000);

        return () => window.clearInterval(timer);
    }, [currentUser?.uid, refreshTrustStatus]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        void refreshIntelligence();
    }, [currentUser?.uid, refreshIntelligence]);

    useEffect(() => {
        const requestedTab = String(searchParams.get('tab') || '').trim();
        if (requestedTab && TABS.some((tab) => tab.id === requestedTab)) {
            setActiveTab(requestedTab);
        }
    }, [searchParams]);

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

    const handleSaveProfile = async () => {
        setSaving(true);
        try {
            const payload = {
                ...editForm,
                phone: normalizePhone(editForm.phone),
                bio: trimText(editForm.bio),
                name: trimText(editForm.name),
            };

            const updated = updateProfileInContext
                ? await updateProfileInContext(payload)
                : await userApi.updateProfile(payload);

            setProfile((previous) => ({ ...previous, ...updated }));
            setEditForm(createEditForm({ ...profile, ...updated }));
            setEditMode(false);
            showMsg('success', 'Profile updated successfully.');
        } catch (error) {
            showMsg('error', error.message || 'Failed to update profile.');
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
                showMsg('success', 'Avatar updated.');
            } catch (error) {
                showMsg('error', error.message || 'Failed to update avatar.');
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
        setShowAddressForm(false);
    };

    const handleSaveAddress = async () => {
        setSaving(true);
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
            showMsg('success', editingAddress ? 'Address updated.' : 'Address saved.');
        } catch (error) {
            showMsg('error', error.message || 'Failed to save address.');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAddress = async (id) => {
        if (!confirm('Delete this address?')) return;
        try {
            const result = await userApi.deleteAddress(id);
            setProfile((previous) => ({ ...previous, addresses: result.addresses }));
            showMsg('success', 'Address deleted.');
        } catch (error) {
            showMsg('error', error.message || 'Failed to delete address.');
        }
    };

    const handleSecureRecovery = async () => {
        const recoveryEmail = String(profileEmail || '').trim().toLowerCase();
        const recoveryPhone = normalizedProfilePhone;

        if (!recoveryEmail || !PHONE_REGEX.test(recoveryPhone) || !hasOtpReadyIdentity) {
            showMsg('error', 'Secure recovery requires the verified account email and registered phone number.');
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
            showMsg('error', error.message || 'Failed to open secure recovery.');
        }

        setRecoveryLaunching(false);
    };

    const handleSetDefaultMethod = async (methodId) => {
        try {
            await paymentApi.setDefaultMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', 'Default payment method updated.');
        } catch (error) {
            showMsg('error', error.message || 'Failed to update default payment method.');
        }
    };

    const handleDeletePaymentMethod = async (methodId) => {
        if (!confirm('Are you sure you want to delete this payment method?')) return;
        try {
            await paymentApi.deleteMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', 'Payment method deleted.');
        } catch (error) {
            showMsg('error', error.message || 'Failed to delete payment method.');
        }
    };

    const handleOptimizeRewards = async () => {
        setOptimizing(true);
        try {
            await intelligenceApi.optimizeRewards();
            showMsg('success', 'Aura Intelligence optimization started. Fresh insights will appear shortly.');
            window.setTimeout(() => {
                void refreshIntelligence({ silent: true });
            }, 6000);
        } catch (error) {
            showMsg('error', error.message || 'Failed to start optimization.');
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

    const stats = dashboard?.stats || {};
    const recentOrders = dashboard?.recentOrders || [];
    const rewardSnapshot = rewards || stats.rewards || profile?.loyalty || {};
    const rewardActivity = Array.isArray(rewards?.recentActivity)
        ? rewards.recentActivity
        : Array.isArray(profile?.loyalty?.ledger)
            ? profile.loyalty.ledger.slice(0, 20)
            : [];
    const auraPoints = Number(rewardSnapshot.pointsBalance || 0);
    const auraTier = rewardSnapshot.tier || 'Rookie';
    const nextMilestone = rewardSnapshot.nextMilestone === null ? null : Number(rewardSnapshot.nextMilestone || 0);
    const profileName = profile?.name || dbUser?.name || currentUser?.displayName || 'Aura Member';
    const profileEmail = profile?.email || dbUser?.email || currentUser?.email || '';
    const profilePhone = profile?.phone || dbUser?.phone || '';
    const initials = (profileName || 'U')
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    const memberSince = profile?.createdAt
        ? new Date(profile.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : 'Recently joined';
    const normalizedProfilePhone = normalizePhone(profilePhone);
    const hasValidProfilePhone = PHONE_REGEX.test(normalizedProfilePhone);
    const hasOtpReadyIdentity = Boolean((profile?.isVerified || currentUser?.emailVerified) && hasValidProfilePhone);
    const paymentMethodsSecured = paymentMethods.length > 0 && paymentMethods.some((method) => method.isDefault);
    const trustHealthy = trustStatus.derivedStatus === 'healthy';
    const isAdminAccount = Boolean(profile?.isAdmin || dbUser?.isAdmin);
    const accountState = profile?.accountState || 'active';
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
            label: 'Orders tracked',
            value: Number(stats.totalOrders || 0).toLocaleString('en-IN'),
            detail: 'Customer activity',
        },
        {
            label: 'Wishlist intent',
            value: Number(wishlistItems?.length || 0).toLocaleString('en-IN'),
            detail: 'Saved demand signals',
        },
        {
            label: 'Listings active',
            value: Number(stats.listings?.active || 0).toLocaleString('en-IN'),
            detail: 'Marketplace presence',
        },
        {
            label: 'Aura points',
            value: auraPoints.toLocaleString('en-IN'),
            detail: `${auraTier} reward posture`,
        },
    ];

    const accountStateTone = {
        active: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200',
        warned: 'border-amber-400/25 bg-amber-500/12 text-amber-100',
        suspended: 'border-rose-400/25 bg-rose-500/12 text-rose-100',
        deleted: 'border-zinc-400/25 bg-zinc-500/12 text-zinc-200',
    };

    if (loading) {
        return (
            <div className="min-h-screen profile-theme profile-premium-shell flex items-center justify-center px-4">
                <div className="premium-panel premium-grid-backdrop relative z-10 w-full max-w-lg p-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                        <div className="h-8 w-8 rounded-full border-4 border-neo-cyan border-t-transparent animate-spin" />
                    </div>
                    <p className="premium-kicker">Aura Identity Suite</p>
                    <h2 className="mt-3 text-2xl font-black text-white">Preparing your profile cockpit</h2>
                    <p className="mt-3 text-sm text-slate-400">Syncing your account, rewards, addresses, and trust posture.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen profile-theme profile-premium-shell">
            {message.text ? (
                <div
                    className={cn(
                        'fixed left-4 right-4 top-4 z-50 flex items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-bold shadow-xl animate-slide-in sm:left-auto sm:right-6 sm:top-6',
                        message.type === 'success'
                            ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-50'
                            : 'border-rose-400/30 bg-rose-500/15 text-rose-50',
                    )}
                >
                    {message.type === 'success' ? <Sparkles className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    {message.text}
                </div>
            ) : null}

            <div className="max-w-7xl mx-auto px-4 pt-6 sm:pt-8">
                <AccountStatusBanner accountState={profile?.accountState} moderation={profile?.moderation} />

                <section className="profile-premium-hero">
                    <div className="mb-6 flex flex-wrap items-center gap-3">
                        <span className="premium-eyebrow">Profile Command Deck</span>
                        <span className="premium-chip-muted">Completion {profileCompletion}%</span>
                        <span className="premium-chip-muted">Aura tier: {auraTier}</span>
                        <span className={cn('premium-chip text-xs font-black uppercase tracking-[0.18em]', accountStateTone[accountState] || accountStateTone.active)}>
                            {String(accountState).replace(/_/g, ' ')}
                        </span>
                    </div>

                    <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
                        <div className="relative shrink-0">
                            <div
                                className="relative group cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        fileInputRef.current?.click();
                                    }
                                }}
                            >
                                <div className="w-32 h-32 rounded-[1.9rem] border border-white/15 bg-white/10 overflow-hidden shadow-[0_24px_60px_rgba(2,8,23,0.32)] backdrop-blur-xl">
                                    {profile?.avatar ? (
                                        <img src={profile.avatar} alt={`${profileName} avatar`} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white">
                                            {initials}
                                        </div>
                                    )}
                                </div>
                                <div className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-[#081018] text-neo-cyan shadow-lg transition-transform duration-300 group-hover:scale-105">
                                    <Camera className="h-5 w-5" />
                                </div>
                            </div>
                            <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-3">
                                <span
                                    className={cn(
                                        'premium-chip text-xs font-black uppercase tracking-[0.18em]',
                                        hasOtpReadyIdentity
                                            ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200'
                                            : 'border-amber-400/25 bg-amber-500/12 text-amber-100',
                                    )}
                                >
                                    <Shield className="w-3 h-3" />
                                    {hasOtpReadyIdentity ? 'Verified identity' : 'Identity needs attention'}
                                </span>
                                {isAdminAccount ? (
                                    <span className="premium-chip text-xs font-black uppercase tracking-[0.18em] border-amber-400/25 bg-amber-500/12 text-amber-100">
                                        <Star className="w-3 h-3" /> Admin account
                                    </span>
                                ) : null}
                                <span className="premium-chip-muted text-xs">
                                    <Calendar className="w-3 h-3" /> Member since {memberSince}
                                </span>
                                <span className="premium-chip-muted text-xs">
                                    <Activity className="w-3 h-3" /> {trustHealthy ? 'Trust healthy' : 'Trust monitoring degraded'}
                                </span>
                            </div>

                            <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl xl:text-6xl">
                                {profileName}
                            </h1>
                            <p className="mt-3 max-w-3xl text-base text-slate-300 sm:text-lg">
                                {profile?.bio
                                    || 'Your Aura profile now acts as a member command deck for identity, trust posture, rewards, support, and marketplace activity.'}
                            </p>

                            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                                <span>{profileEmail || 'No email on file'}</span>
                                <span className="hidden sm:inline text-slate-600">•</span>
                                <span>{profilePhone || 'No verified phone yet'}</span>
                                <span className="hidden sm:inline text-slate-600">•</span>
                                <span>{paymentMethods.length} saved payment {paymentMethods.length === 1 ? 'method' : 'methods'}</span>
                            </div>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('personal')}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-3 text-sm font-black text-[#051018] shadow-[0_18px_40px_rgba(34,211,238,0.22)] transition-transform hover:scale-[1.01]"
                                >
                                    <Edit3 className="h-4 w-4" />
                                    Refine profile
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('orders')}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
                                >
                                    View orders <ArrowRight className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('support')}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
                                >
                                    Support & appeals
                                </button>
                            </div>

                            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {heroMetrics.map((metric) => (
                                    <div key={metric.label} className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-xl">
                                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{metric.label}</p>
                                        <p className="mt-2 text-2xl font-black tracking-tight text-white">{metric.value}</p>
                                        <p className="mt-1 text-xs text-slate-500">{metric.detail}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <div className="mt-8 flex gap-2 overflow-x-auto pb-4">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => handleTabChange(tab.id)}
                            className={cn('profile-premium-tab-pill', activeTab === tab.id && 'profile-premium-tab-pill-active')}
                        >
                            <tab.icon className="w-4 h-4" /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="py-8">
                    {activeTab === 'overview' ? (
                        <OverviewSection
                            stats={stats}
                            cartItems={cartItems}
                            wishlistItems={wishlistItems}
                            recentOrders={recentOrders}
                            auraPoints={auraPoints}
                            auraTier={auraTier}
                            isAdminAccount={isAdminAccount}
                            profile={profile}
                            memberSince={memberSince}
                            hasOtpReadyIdentity={hasOtpReadyIdentity}
                            paymentMethodsSecured={paymentMethodsSecured}
                            paymentMethodCount={paymentMethods.length}
                            trustHealthy={trustHealthy}
                            profileCompletion={profileCompletion}
                        />
                    ) : null}

                    {activeTab === 'personal' ? (
                        <PersonalInfoSection
                            profile={profile}
                            profileName={profileName}
                            profileEmail={profileEmail}
                            profilePhone={profilePhone}
                            editMode={editMode}
                            setEditMode={setEditMode}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            saving={saving}
                            handleSaveProfile={handleSaveProfile}
                            createEditForm={createEditForm}
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
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
