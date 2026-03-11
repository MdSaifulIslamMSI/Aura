import { useState, useEffect, useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
    User, Mail, Phone, Calendar, MapPin, Shield, Package, Heart, ShoppingCart,
    Edit3, Camera, Save, X, Plus, Trash2, Star, Eye, ChevronRight, LogOut,
    Home as HomeIcon, Briefcase, Check, AlertTriangle, Clock, CreditCard,
    Tag, Store, BarChart3, Settings, Lock, Bell, Activity, Sparkles, Trophy
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import PremiumSelect from '@/components/ui/premium-select';
import { paymentApi, trustApi, userApi } from '@/services/api';
import { cn } from '@/lib/utils';

const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'personal', label: 'Personal Info', icon: User },
    { id: 'addresses', label: 'Addresses', icon: MapPin },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'rewards', label: 'Aura Points', icon: Sparkles },
    { id: 'listings', label: 'My Listings', icon: Store },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'settings', label: 'Settings', icon: Settings },
];

const ADDRESS_TYPES = [
    { value: 'home', label: 'Home', icon: HomeIcon },
    { value: 'work', label: 'Work', icon: Briefcase },
    { value: 'other', label: 'Other', icon: MapPin },
];

const PHONE_REGEX = /^\+?\d{10,15}$/;
const PINCODE_REGEX = /^\d{6}$/;
const VALID_GENDERS = new Set(['', 'male', 'female', 'other', 'prefer-not-to-say']);
const VALID_ADDRESS_TYPES = new Set(ADDRESS_TYPES.map((type) => type.value));
const normalizePhone = (phone) => String(phone || '').replace(/[\s\-()]/g, '').trim();
const trimText = (value) => String(value || '').trim();

export default function Profile() {
    const { currentUser, dbUser, logout, updateProfile: updateProfileInContext, forgotPassword } = useContext(AuthContext);
    const { cartItems } = useContext(CartContext);
    const { wishlistItems } = useContext(WishlistContext);
    const [activeTab, setActiveTab] = useState('overview');
    const [profile, setProfile] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [passwordResetting, setPasswordResetting] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
    const [rewards, setRewards] = useState(null);
    const [rewardsLoading, setRewardsLoading] = useState(false);
    const [trustStatus, setTrustStatus] = useState({
        backend: { status: 'degraded', db: 'unknown', uptime: 0, timestamp: null },
        client: { online: true, secureContext: false, language: 'unknown', timezone: 'unknown' },
        derivedStatus: 'degraded',
    });
    const [trustLoading, setTrustLoading] = useState(false);

    // Editable fields
    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState({});

    // Address form
    const [showAddressForm, setShowAddressForm] = useState(false);
    const [editingAddress, setEditingAddress] = useState(null);
    const [addressForm, setAddressForm] = useState({
        type: 'home', name: '', phone: '', address: '', city: '', state: '', pincode: '', isDefault: false
    });

    const fileInputRef = useRef(null);
    const createEditForm = (source = {}) => ({
        name: source.name || '',
        phone: source.phone || '',
        gender: source.gender || '',
        dob: source.dob ? new Date(source.dob).toISOString().split('T')[0] : '',
        bio: source.bio || '',
    });

    // Fetch profile and dashboard data
    useEffect(() => {
        if (!currentUser?.email) return;
        (async () => {
            try {
                const [profileData, dashData] = await Promise.all([
                    userApi.getProfile(currentUser.email),
                    userApi.getDashboard()
                ]);
                setProfile(profileData);
                setDashboard(dashData);
                setEditForm(createEditForm(profileData));
            } catch (err) {
                console.error('Profile fetch failed:', err);
                if (dbUser?.email) {
                    setProfile((prev) => ({ ...(prev || {}), ...dbUser }));
                    setEditForm((prev) => ({ ...prev, name: dbUser.name || prev.name || '', phone: dbUser.phone || prev.phone || '' }));
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [currentUser?.email]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!dbUser) return;
        setProfile((prev) => ({ ...(prev || {}), ...dbUser }));
        setEditForm((prev) => ({
            ...prev,
            name: dbUser.name || prev.name || '',
            phone: dbUser.phone || prev.phone || '',
        }));
    }, [dbUser]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!currentUser?.uid) return;
        setPaymentMethodsLoading(true);
        paymentApi.getMethods()
            .then((methods) => setPaymentMethods(methods || []))
            .catch((err) => console.error('Payment methods fetch failed:', err.message))
            .finally(() => setPaymentMethodsLoading(false));
    }, [currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let mounted = true;
        if (!currentUser?.uid) return () => {};

        setRewardsLoading(true);
        userApi.getRewards()
            .then((result) => {
                if (!mounted) return;
                setRewards(result?.rewards || null);
            })
            .catch((error) => {
                if (!mounted) return;
                setRewards(null);
                console.error('Rewards fetch failed:', error.message);
            })
            .finally(() => {
                if (mounted) setRewardsLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [currentUser?.uid]);

    useEffect(() => {
        let mounted = true;
        if (!currentUser?.uid) return () => {};

        const loadTrustStatus = async () => {
            setTrustLoading(true);
            try {
                const status = await trustApi.getHealthStatus();
                if (mounted) setTrustStatus(status);
            } catch (error) {
                if (mounted) {
                    setTrustStatus((prev) => ({
                        ...prev,
                        derivedStatus: 'degraded',
                        backend: { ...prev.backend, status: 'degraded' },
                    }));
                }
                console.error('Trust status fetch failed:', error.message);
            } finally {
                if (mounted) setTrustLoading(false);
            }
        };

        loadTrustStatus();
        const timer = setInterval(loadTrustStatus, 60000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [currentUser?.uid]);

    const showMsg = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    };

    const buildProfilePayload = () => {
        const name = trimText(editForm.name);
        const phone = normalizePhone(editForm.phone);
        const gender = trimText(editForm.gender).toLowerCase();
        const dob = editForm.dob ? String(editForm.dob).trim() : '';
        const bio = trimText(editForm.bio);

        if (name.length < 2) {
            return { error: 'Name must be at least 2 characters long' };
        }
        if (phone && !PHONE_REGEX.test(phone)) {
            return { error: 'Valid phone number is required (10-15 digits)' };
        }
        if (!VALID_GENDERS.has(gender)) {
            return { error: 'Invalid gender value' };
        }
        if (bio.length > 200) {
            return { error: 'Bio cannot exceed 200 characters' };
        }
        if (dob) {
            const dobDate = new Date(dob);
            if (Number.isNaN(dobDate.getTime())) {
                return { error: 'Invalid date of birth' };
            }
            if (dobDate > new Date()) {
                return { error: 'Date of birth cannot be in the future' };
            }
        }

        return {
            payload: {
                name,
                phone,
                gender,
                dob: dob || null,
                bio,
            },
        };
    };

    // Profile update
    const handleSaveProfile = async () => {
        const { payload, error } = buildProfilePayload();
        if (error) {
            showMsg('error', error);
            return;
        }

        setSaving(true);
        try {
            const updated = updateProfileInContext
                ? await updateProfileInContext(payload)
                : await userApi.updateProfile(payload);
            setProfile(prev => ({ ...prev, ...updated }));
            setEditForm(createEditForm(updated));
            setEditMode(false);
            showMsg('success', 'Profile updated successfully!');
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    // Avatar upload
    const handleAvatarChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showMsg('error', 'Image must be under 2MB');
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const updated = updateProfileInContext
                    ? await updateProfileInContext({ avatar: reader.result })
                    : await userApi.updateProfile({ avatar: reader.result });
                setProfile(prev => ({ ...prev, avatar: updated.avatar }));
                showMsg('success', 'Avatar updated!');
            } catch (err) {
                showMsg('error', err.message);
            }
        };
        reader.readAsDataURL(file);
    };

    // Address CRUD
    const resetAddressForm = () => {
        setAddressForm({ type: 'home', name: '', phone: '', address: '', city: '', state: '', pincode: '', isDefault: false });
        setEditingAddress(null);
        setShowAddressForm(false);
    };

    const buildAddressPayload = () => {
        const type = trimText(addressForm.type).toLowerCase() || 'home';
        const name = trimText(addressForm.name);
        const phone = normalizePhone(addressForm.phone);
        const address = trimText(addressForm.address);
        const city = trimText(addressForm.city);
        const state = trimText(addressForm.state);
        const pincode = trimText(addressForm.pincode);

        if (!VALID_ADDRESS_TYPES.has(type)) {
            return { error: 'Invalid address type' };
        }
        if (!name || !phone || !address || !city || !state || !pincode) {
            return { error: 'All address fields are required' };
        }
        if (!PHONE_REGEX.test(phone)) {
            return { error: 'Valid address phone number is required' };
        }
        if (!PINCODE_REGEX.test(pincode)) {
            return { error: 'Pincode must be exactly 6 digits' };
        }

        return {
            payload: {
                type,
                name,
                phone,
                address,
                city,
                state,
                pincode,
                isDefault: Boolean(addressForm.isDefault),
            },
        };
    };

    const handleSaveAddress = async () => {
        const { payload, error } = buildAddressPayload();
        if (error) {
            showMsg('error', error);
            return;
        }

        setSaving(true);
        try {
            let result;
            if (editingAddress) {
                result = await userApi.updateAddress(editingAddress, payload);
            } else {
                result = await userApi.addAddress(payload);
            }
            setProfile(prev => ({ ...prev, addresses: result.addresses }));
            resetAddressForm();
            showMsg('success', editingAddress ? 'Address updated!' : 'Address added!');
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAddress = async (id) => {
        if (!confirm('Delete this address?')) return;
        try {
            const result = await userApi.deleteAddress(id);
            setProfile(prev => ({ ...prev, addresses: result.addresses }));
            showMsg('success', 'Address deleted');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const startEditAddress = (addr) => {
        setAddressForm({
            type: addr.type || 'home',
            name: addr.name || '',
            phone: addr.phone || '',
            address: addr.address || '',
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || '',
            isDefault: Boolean(addr.isDefault)
        });
        setEditingAddress(addr._id);
        setShowAddressForm(true);
    };

    const handlePasswordReset = async () => {
        const email = profile?.email || currentUser?.email;
        if (!email) {
            showMsg('error', 'No email found for this account');
            return;
        }

        setPasswordResetting(true);
        try {
            await forgotPassword(email);
            showMsg('success', `Password reset link sent to ${email}`);
        } catch (err) {
            showMsg('error', err.message || 'Failed to send password reset email');
        } finally {
            setPasswordResetting(false);
        }
    };

    const refreshPaymentMethods = async () => {
        try {
            const methods = await paymentApi.getMethods();
            setPaymentMethods(methods || []);
        } catch (err) {
            console.error('Failed to refresh payment methods:', err.message);
        }
    };

    const handleSetDefaultMethod = async (methodId) => {
        try {
            await paymentApi.setDefaultMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', 'Default payment method updated');
        } catch (err) {
            showMsg('error', err.message || 'Failed to set default payment method');
        }
    };

    const handleDeletePaymentMethod = async (methodId) => {
        if (!confirm('Remove this saved payment method?')) return;
        try {
            await paymentApi.deleteMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', 'Payment method removed');
        } catch (err) {
            showMsg('error', err.message || 'Failed to remove payment method');
        }
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

    const memberSince = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '';
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
    const profileName = profile?.name || dbUser?.name || currentUser?.displayName || '';
    const profileEmail = profile?.email || dbUser?.email || currentUser?.email || '';
    const profilePhone = profile?.phone || dbUser?.phone || '';
    const initials = (profileName || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const normalizedProfilePhone = normalizePhone(profilePhone || '');
    const hasValidProfilePhone = PHONE_REGEX.test(normalizedProfilePhone);
    const hasOtpReadyIdentity = Boolean(profile?.isVerified && hasValidProfilePhone);
    const paymentMethodsSecured = paymentMethods.length > 0 && paymentMethods.some((method) => method.isDefault);
    const trustHealthy = trustStatus.derivedStatus === 'healthy';
    const isAdminAccount = Boolean(profile?.isAdmin || dbUser?.isAdmin);

    return (
        <div className="min-h-screen profile-theme profile-premium-shell">
            {/* Toast Message */}
            {message.text && (
                <div className={cn(
                    'fixed top-4 left-4 right-4 sm:top-6 sm:left-auto sm:right-6 z-50 flex items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-bold shadow-xl animate-slide-in backdrop-blur-xl',
                    message.type === 'success'
                        ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-50'
                        : 'border-rose-400/30 bg-rose-500/15 text-rose-50'
                )}>
                    {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {/* Profile Header */}
            <div className="relative z-10">
                <div className="max-w-7xl mx-auto px-4 pt-6 sm:pt-8">
                    <div className="profile-premium-hero">
                        <div className="mb-6 flex flex-wrap items-center gap-3">
                            <span className="premium-eyebrow">Profile Command Deck</span>
                            <span className="premium-chip-muted">Live account posture</span>
                            <span className="premium-chip-muted">Aura tier: {auraTier}</span>
                        </div>
                        <div className="flex flex-col gap-6 xl:flex-row xl:items-center">
                        {/* Avatar */}
                        <div className="relative group">
                            <div className="w-28 h-28 rounded-[1.7rem] border border-white/15 bg-white/10 overflow-hidden shadow-[0_24px_60px_rgba(2,8,23,0.32)] backdrop-blur-xl">
                                {profile?.avatar ? (
                                    <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white">
                                        {initials}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/90 text-slate-950 shadow-lg opacity-0 transition-opacity cursor-pointer group-hover:opacity-100"
                            >
                                <Camera className="w-4 h-4" />
                            </button>
                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                        </div>

                        {/* Info */}
                        <div className="w-full text-center md:text-left xl:max-w-2xl">
                            <p className="premium-kicker">Identity and commerce readiness</p>
                            <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">{profileName || 'Not set'}</h1>
                            <p className="mt-2 text-sm text-slate-300 md:text-base">{profileEmail || 'Not set'}</p>
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                                {profile?.isVerified && (
                                    <span className={cn(
                                        'premium-chip text-xs font-black uppercase tracking-[0.18em]',
                                        hasOtpReadyIdentity
                                            ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200'
                                            : 'border-amber-400/25 bg-amber-500/12 text-amber-100'
                                    )}>
                                        <Shield className="w-3 h-3" /> {hasOtpReadyIdentity ? 'Verified' : 'Partially Verified'}
                                    </span>
                                )}
                                {profile?.isAdmin && (
                                    <span className="premium-chip text-xs font-black uppercase tracking-[0.18em] border-amber-400/25 bg-amber-500/12 text-amber-100">
                                        <Star className="w-3 h-3" /> Admin
                                    </span>
                                )}
                                <span className="premium-chip-muted text-xs">
                                    <Calendar className="w-3 h-3" /> Member since {memberSince}
                                </span>
                            </div>
                            {profile?.bio && (
                                <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">{profile.bio}</p>
                            )}
                            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('personal')}
                                    className="profile-premium-button profile-premium-button-primary"
                                >
                                    <Edit3 className="w-4 h-4" />
                                    Refine profile
                                </button>
                                <Link
                                    to="/orders"
                                    className="profile-premium-button"
                                >
                                    <Package className="w-4 h-4" />
                                    View orders
                                </Link>
                            </div>
                            {isAdminAccount && (
                                <div className="mt-4 flex flex-wrap items-center gap-2 justify-center md:justify-start">
                                    <Link
                                        to="/admin/dashboard"
                                        className="profile-premium-button"
                                    >
                                        <Shield className="w-3.5 h-3.5" />
                                        Open Admin Portal
                                    </Link>
                                    <Link
                                        to="/admin/products"
                                        className="profile-premium-button"
                                    >
                                        <Store className="w-3.5 h-3.5" />
                                        Manage Products
                                    </Link>
                                </div>
                            )}
                        </div>

                        {/* Quick Stats */}
                        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 xl:ml-auto xl:w-[28rem]">
                            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 text-center min-w-0 backdrop-blur-xl">
                                <p className="text-2xl font-black text-white">{stats.totalOrders || 0}</p>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Orders</p>
                            </div>
                            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 text-center min-w-0 backdrop-blur-xl">
                                <p className="text-2xl font-black text-white">{wishlistItems?.length || 0}</p>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Wishlist</p>
                            </div>
                            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 text-center min-w-0 backdrop-blur-xl">
                                <p className="text-2xl font-black text-white">{stats.listings?.active || 0}</p>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Listings</p>
                            </div>
                            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 text-center min-w-0 backdrop-blur-xl">
                                <p className="text-2xl font-black text-white">{auraPoints.toLocaleString('en-IN')}</p>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Aura Points</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            </div>

            {/* Tabs */}
            <div className="sticky top-20 md:top-24 z-20 px-4 pt-4">
                <div className="max-w-7xl mx-auto overflow-x-auto">
                    <div className="profile-premium-tab-shell">
                        <div className="profile-premium-tab-list">
                        {TABS.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'profile-premium-tab-pill whitespace-nowrap',
                                        isActive && 'profile-premium-tab-pill-active'
                                    )}>
                                    <Icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            );
                        })}
                        </div>
                    </div>
                </div>
            </div>

            <div className="profile-premium-content max-w-7xl mx-auto px-4 py-6 sm:py-8">
                {/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ OVERVIEW TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
                {activeTab === 'overview' && (
                    <div className="space-y-8">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                            <StatCard icon={Package} label="Total Orders" value={stats.totalOrders || 0} color="blue" />
                            <StatCard icon={CreditCard} label="Total Spent" value={`Ã¢â€šÂ¹${(stats.totalSpent || 0).toLocaleString('en-IN')}`} color="green" />
                            <StatCard icon={Heart} label="Wishlist Items" value={wishlistItems?.length || 0} color="pink" />
                            <StatCard icon={ShoppingCart} label="Cart Items" value={cartItems?.length || 0} color="purple" />
                            <StatCard icon={Sparkles} label="Aura Points" value={auraPoints.toLocaleString('en-IN')} color="amber" />
                            <StatCard icon={Trophy} label="Tier" value={auraTier} color="cyan" />
                        </div>

                        {/* Marketplace Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <StatCard icon={Store} label="Active Listings" value={stats.listings?.active || 0} color="indigo" />
                            <StatCard icon={Tag} label="Items Sold" value={stats.listings?.sold || 0} color="emerald" />
                            <StatCard icon={Eye} label="Total Views" value={stats.listings?.totalViews || 0} color="amber" />
                        </div>

                        {/* Recent Orders */}
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                                <h3 className="font-bold text-gray-900 flex items-center gap-2"><Package className="w-5 h-5 text-indigo-500" /> Recent Orders</h3>
                                <Link to="/orders" className="text-sm text-indigo-600 font-semibold hover:underline">View All Ã¢â€ â€™</Link>
                            </div>
                            {recentOrders.length === 0 ? (
                                <div className="text-center py-8">
                                    <Package className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                                    <p className="text-gray-400 text-sm">No orders yet</p>
                                    <Link to="/products" className="text-indigo-600 text-sm font-semibold hover:underline mt-1 inline-block">Start Shopping Ã¢â€ â€™</Link>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {recentOrders.map(order => (
                                        <div key={order._id} className="flex items-center gap-4 p-3 border rounded-xl hover:bg-gray-50 transition-colors">
                                            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                                <Package className="w-6 h-6 text-indigo-500" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-gray-900 text-sm truncate">
                                                    {order.orderItems?.map(i => i.title).join(', ') || 'Order'}
                                                </p>
                                                <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-gray-900">Ã¢â€šÂ¹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                          ${order.isDelivered ? 'bg-green-100 text-green-700' : order.isPaid ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                                    {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Quick Links */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <QuickLink to="/marketplace" icon={Store} label="Marketplace" desc="Browse listings" />
                            <QuickLink to="/sell" icon={Plus} label="Sell Item" desc="Post a listing" />
                            <QuickLink to="/my-listings" icon={Tag} label="My Listings" desc="Manage items" />
                            <QuickLink to="/wishlist" icon={Heart} label="Wishlist" desc={`${wishlistItems?.length || 0} items saved`} />
                            {isAdminAccount && (
                                <QuickLink to="/admin/dashboard" icon={Shield} label="Admin Console" desc="Secure admin operations" />
                            )}
                        </div>
                    </div>
                )}

                {/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ PERSONAL INFO TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
                {activeTab === 'personal' && (
                    <div className="max-w-2xl">
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">Personal Information</h3>
                                {editMode ? (
                                    <div className="flex gap-2">
                                        <button onClick={() => { setEditMode(false); setEditForm(createEditForm(profile)); }}
                                            className="px-4 py-2 border rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
                                            Cancel
                                        </button>
                                        <button onClick={handleSaveProfile} disabled={saving}
                                            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                            Save
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setEditMode(true)}
                                        className="flex items-center gap-2 px-4 py-2 text-indigo-600 font-bold text-sm border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                                        <Edit3 className="w-4 h-4" /> Edit
                                    </button>
                                )}
                            </div>

                            <div className="space-y-5">
                                <InfoRow icon={User} label="Full Name"
                                    value={editMode ? (
                                        <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                                            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    ) : (profileName || 'Not set')} />

                                <InfoRow icon={Mail} label="Email Address"
                                    value={profileEmail || 'Not set'}
                                    badge="Cannot be changed" />

                                <InfoRow icon={Phone} label="Phone Number"
                                    value={editMode ? (
                                        <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                                            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    ) : (profilePhone || 'Not set')} />

                                <InfoRow icon={User} label="Gender"
                                    value={editMode ? (
                                        <PremiumSelect value={editForm.gender} onChange={e => setEditForm(p => ({ ...p, gender: e.target.value }))}
                                            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none bg-white">
                                            <option value="">Prefer not to say</option>
                                            <option value="male">Male</option>
                                            <option value="female">Female</option>
                                            <option value="other">Other</option>
                                        </PremiumSelect>
                                    ) : (profile?.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : 'Not specified')} />

                                <InfoRow icon={Calendar} label="Date of Birth"
                                    value={editMode ? (
                                        <input type="date" value={editForm.dob} onChange={e => setEditForm(p => ({ ...p, dob: e.target.value }))}
                                            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    ) : (profile?.dob ? new Date(profile.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set')} />

                                <InfoRow icon={Edit3} label="Bio"
                                    value={editMode ? (
                                        <textarea value={editForm.bio} onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))}
                                            maxLength={200} rows={3} placeholder="Tell us about yourself..."
                                            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none resize-none" />
                                    ) : (profile?.bio || 'No bio added')} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ADDRESSES TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
                {activeTab === 'addresses' && (
                    <div className="max-w-3xl space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <h3 className="text-lg font-bold text-gray-900">Saved Addresses</h3>
                            <button onClick={() => { resetAddressForm(); setShowAddressForm(true); }}
                                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 transition-colors">
                                <Plus className="w-4 h-4" /> Add Address
                            </button>
                        </div>

                        {/* Address Form Modal */}
                        {showAddressForm && (
                            <div className="bg-white rounded-2xl border shadow-sm p-6">
                                <h4 className="font-bold text-gray-900 mb-4">{editingAddress ? 'Edit Address' : 'New Address'}</h4>

                                {/* Type selector */}
                                <div className="flex gap-3 mb-4">
                                    {ADDRESS_TYPES.map(t => {
                                        const Icon = t.icon;
                                        return (
                                            <button key={t.value} onClick={() => setAddressForm(p => ({ ...p, type: t.value }))}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                          ${addressForm.type === t.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
                                                <Icon className="w-4 h-4" /> {t.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <input value={addressForm.name} onChange={e => setAddressForm(p => ({ ...p, name: e.target.value }))}
                                        placeholder="Full Name *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    <input value={addressForm.phone} onChange={e => setAddressForm(p => ({ ...p, phone: e.target.value }))}
                                        placeholder="Phone Number *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    <textarea value={addressForm.address} onChange={e => setAddressForm(p => ({ ...p, address: e.target.value }))}
                                        placeholder="Full Address *" rows={2}
                                        className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none resize-none sm:col-span-2" />
                                    <input value={addressForm.city} onChange={e => setAddressForm(p => ({ ...p, city: e.target.value }))}
                                        placeholder="City *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    <input value={addressForm.state} onChange={e => setAddressForm(p => ({ ...p, state: e.target.value }))}
                                        placeholder="State *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    <input value={addressForm.pincode} onChange={e => setAddressForm(p => ({ ...p, pincode: e.target.value }))}
                                        placeholder="Pincode *" maxLength={6} className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                                    <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border-2 border-gray-200 cursor-pointer">
                                        <input type="checkbox" checked={addressForm.isDefault}
                                            onChange={e => setAddressForm(p => ({ ...p, isDefault: e.target.checked }))}
                                            className="w-5 h-5 text-indigo-600 rounded" />
                                        <span className="font-semibold text-gray-700 text-sm">Set as default</span>
                                    </label>
                                </div>

                                <div className="flex gap-3 mt-5">
                                    <button onClick={handleSaveAddress} disabled={saving || !addressForm.name || !addressForm.phone || !addressForm.address || !addressForm.city || !addressForm.state || !addressForm.pincode}
                                        className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                                        {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                        {editingAddress ? 'Update' : 'Save'} Address
                                    </button>
                                    <button onClick={resetAddressForm}
                                        className="px-5 py-2.5 border rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Address Cards */}
                        {(!profile?.addresses || profile.addresses.length === 0) && !showAddressForm ? (
                            <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
                                <MapPin className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                                <h3 className="text-lg font-bold text-gray-900 mb-1">No addresses saved</h3>
                                <p className="text-gray-400 text-sm">Add your delivery address for faster checkout</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {profile?.addresses?.map(addr => {
                                    const TypeIcon = ADDRESS_TYPES.find(t => t.value === addr.type)?.icon || MapPin;
                                    return (
                                        <div key={addr._id} className={`bg-white rounded-2xl border shadow-sm p-5 relative ${addr.isDefault ? 'ring-2 ring-indigo-500' : ''}`}>
                                            {addr.isDefault && (
                                                <span className="absolute top-3 right-3 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full">DEFAULT</span>
                                            )}
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                                                    <TypeIcon className="w-4 h-4 text-indigo-600" />
                                                </div>
                                                <span className="font-bold text-gray-900 capitalize">{addr.type}</span>
                                            </div>
                                            <p className="font-semibold text-gray-900">{addr.name}</p>
                                            <p className="text-sm text-gray-600 mt-1">{addr.address}</p>
                                            <p className="text-sm text-gray-600">{addr.city}, {addr.state} Ã¢â‚¬â€ {addr.pincode}</p>
                                            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1"><Phone className="w-3 h-3" /> {addr.phone}</p>
                                            <div className="flex gap-2 mt-3 pt-3 border-t">
                                                <button onClick={() => startEditAddress(addr)}
                                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                                                    <Edit3 className="w-3 h-3" /> Edit
                                                </button>
                                                <button onClick={() => handleDeleteAddress(addr._id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                                                    <Trash2 className="w-3 h-3" /> Delete
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ORDERS TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
                {activeTab === 'orders' && (
                    <div className="max-w-3xl">
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">Order History</h3>
                                <span className="text-sm text-gray-400">{stats.totalOrders || 0} total orders</span>
                            </div>
                            {recentOrders.length === 0 ? (
                                <div className="text-center py-12">
                                    <Package className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">No orders yet</h3>
                                    <p className="text-gray-400 text-sm mb-4">Start shopping to see your orders here</p>
                                    <Link to="/products" className="inline-flex px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700">
                                        Shop Now
                                    </Link>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {recentOrders.map(order => (
                                        <div key={order._id} className="border rounded-xl p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                                <div>
                                                    <p className="text-xs text-gray-400">Order #{order._id?.slice(-8).toUpperCase()}</p>
                                                    <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-black text-gray-900">Ã¢â€šÂ¹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                            ${order.isDelivered ? 'bg-green-100 text-green-700' : order.isPaid ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                                        {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 overflow-x-auto">
                                                {order.orderItems?.map((item, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg flex-shrink-0">
                                                        <img src={item.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                                                        <div>
                                                            <p className="text-xs font-semibold text-gray-700 line-clamp-1 max-w-[150px]">{item.title}</p>
                                                            <p className="text-[10px] text-gray-400">Qty: {item.quantity} Ã‚Â· Ã¢â€šÂ¹{item.price}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-3 mt-3 pt-3 border-t text-xs text-gray-400">
                                                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {order.shippingAddress?.city}</span>
                                                <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {order.paymentMethod}</span>
                                            </div>
                                        </div>
                                    ))}
                                    <Link to="/orders" className="block text-center py-3 text-indigo-600 font-bold text-sm hover:underline">
                                        View All Orders Ã¢â€ â€™
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ MY LISTINGS TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
                {activeTab === 'rewards' && (
                    <div className="max-w-3xl space-y-5">
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-amber-500" />
                                        Aura Points Command Center
                                    </h3>
                                    <p className="text-xs text-gray-500 mt-1">Earn points from secure login, orders, and marketplace actions.</p>
                                </div>
                                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-black uppercase tracking-wider">
                                    {auraTier} Tier
                                </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
                                <div className="rounded-xl border bg-amber-50 border-amber-200 p-4">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Balance</p>
                                    <p className="text-2xl font-black text-amber-700 mt-1">{auraPoints.toLocaleString('en-IN')}</p>
                                    <p className="text-xs text-amber-600 mt-1">Aura Points available</p>
                                </div>
                                <div className="rounded-xl border bg-indigo-50 border-indigo-200 p-4">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Lifetime Earned</p>
                                    <p className="text-2xl font-black text-indigo-700 mt-1">{Number(rewardSnapshot.lifetimeEarned || 0).toLocaleString('en-IN')}</p>
                                    <p className="text-xs text-indigo-600 mt-1">Total reward accumulation</p>
                                </div>
                                <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-4">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Login Streak</p>
                                    <p className="text-2xl font-black text-emerald-700 mt-1">{Number(rewardSnapshot.streakDays || 0)}</p>
                                    <p className="text-xs text-emerald-600 mt-1">Consecutive reward days</p>
                                </div>
                            </div>

                            {nextMilestone !== null && Number.isFinite(nextMilestone) && (
                                <div className="mt-4 p-3 rounded-xl border border-gray-200 bg-gray-50">
                                    <p className="text-xs text-gray-600">
                                        Next tier unlock at <span className="font-bold text-gray-900">{nextMilestone.toLocaleString('en-IN')}</span> lifetime points.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="font-bold text-gray-900">Recent Rewards Activity</h4>
                                {rewardsLoading && <span className="text-xs text-gray-400">Syncing...</span>}
                            </div>
                            {rewardActivity.length === 0 ? (
                                <div className="text-center py-8">
                                    <Sparkles className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No rewards activity yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {rewardActivity.slice(0, 12).map((entry, idx) => (
                                        <div key={`${entry.createdAt || idx}-${entry.eventType || 'reward'}`} className="flex items-start justify-between gap-3 border rounded-xl p-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-gray-900">
                                                    {entry.reason || String(entry.eventType || 'Reward').replace(/_/g, ' ')}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-0.5">
                                                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-IN') : 'Recently'}
                                                </p>
                                            </div>
                                            <span className="text-sm font-black text-emerald-600 whitespace-nowrap">
                                                +{Number(entry.points || 0).toLocaleString('en-IN')} AP
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'listings' && (
                    <div className="max-w-3xl">
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">Marketplace Listings</h3>
                                <Link to="/sell" className="flex items-center gap-2 px-5 py-2 bg-green-500 text-white font-bold rounded-lg text-sm hover:bg-green-600 transition-colors">
                                    <Plus className="w-4 h-4" /> New Listing
                                </Link>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                                <div className="bg-indigo-50 rounded-xl p-4 text-center">
                                    <p className="text-2xl font-black text-indigo-600">{stats.listings?.active || 0}</p>
                                    <p className="text-xs text-indigo-400 font-bold">Active</p>
                                </div>
                                <div className="bg-green-50 rounded-xl p-4 text-center">
                                    <p className="text-2xl font-black text-green-600">{stats.listings?.sold || 0}</p>
                                    <p className="text-xs text-green-400 font-bold">Sold</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-4 text-center">
                                    <p className="text-2xl font-black text-amber-600">{stats.listings?.totalViews || 0}</p>
                                    <p className="text-xs text-amber-400 font-bold">Views</p>
                                </div>
                            </div>

                            <Link to="/my-listings"
                                className="block text-center py-3 border-2 border-dashed border-gray-200 rounded-xl text-indigo-600 font-bold text-sm hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                                Manage All Listings {'->'}
                            </Link>
                        </div>
                    </div>
                )}

                {/* PAYMENTS TAB */}
                {activeTab === 'payments' && (
                    <div className="max-w-3xl">
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">Saved Payment Methods</h3>
                                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Tokenized methods only</span>
                            </div>

                            {paymentMethodsLoading ? (
                                <div className="text-sm text-gray-500 py-6">Loading payment methods...</div>
                            ) : paymentMethods.length === 0 ? (
                                <div className="text-center py-10 border border-dashed rounded-xl">
                                    <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                                    <p className="font-semibold text-gray-700">No saved payment methods yet</p>
                                    <p className="text-xs text-gray-400 mt-1">Complete a digital payment to auto-save tokenized methods.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {paymentMethods.map((method) => (
                                        <div key={method._id} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                            <div>
                                                <p className="font-semibold text-gray-900 capitalize">
                                                    {method.type || 'method'}
                                                    {method.brand ? ` | ${method.brand}` : ''}
                                                    {method.last4 ? ` | **** ${method.last4}` : ''}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-1">Provider: {method.provider || 'razorpay'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {method.isDefault ? (
                                                    <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold">
                                                        Default
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSetDefaultMethod(method._id)}
                                                        className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                                                    >
                                                        Set Default
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeletePaymentMethod(method._id)}
                                                    className="px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {activeTab === 'settings' && (
                    <div className="max-w-2xl space-y-6">
                        {/* Security */}
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><Lock className="w-5 h-5 text-indigo-500" /> Security</h3>
                            <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">Password</p>
                                        <p className="text-xs text-gray-400">Managed through Firebase Authentication</p>
                                    </div>
                                    <button
                                        onClick={handlePasswordReset}
                                        disabled={passwordResetting}
                                        className="px-4 py-2 text-indigo-600 font-bold text-sm border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-60"
                                    >
                                        {passwordResetting ? 'Sending...' : 'Send Reset Link'}
                                    </button>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">Two-Factor Auth</p>
                                        <p className="text-xs text-gray-400">
                                            {hasOtpReadyIdentity
                                                ? 'OTP sign-in is ready for your account'
                                                : 'Add a valid phone number to enable OTP sign-in'}
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 text-xs font-bold rounded-full ${hasOtpReadyIdentity ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {hasOtpReadyIdentity ? 'Active' : 'Incomplete'}
                                    </span>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">Account Verified</p>
                                        <p className="text-xs text-gray-400">
                                            {hasOtpReadyIdentity
                                                ? 'Email and phone are verified'
                                                : profile?.isVerified
                                                    ? 'Email is verified, phone verification is incomplete'
                                                    : 'Account verification is pending'}
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 text-xs font-bold rounded-full ${hasOtpReadyIdentity ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {hasOtpReadyIdentity ? 'Verified' : 'Incomplete'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <Activity className="w-5 h-5 text-indigo-500" />
                                Trust & Security Command Center
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                                <div className={`rounded-xl border p-4 ${trustHealthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Platform Status</p>
                                    <p className={`text-sm font-bold mt-1 ${trustHealthy ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        {trustLoading ? 'Checking...' : trustHealthy ? 'Healthy' : 'Degraded'}
                                    </p>
                                </div>
                                <div className={`rounded-xl border p-4 ${hasOtpReadyIdentity ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Identity Posture</p>
                                    <p className={`text-sm font-bold mt-1 ${hasOtpReadyIdentity ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        {hasOtpReadyIdentity ? 'Fortified' : 'Needs Attention'}
                                    </p>
                                </div>
                                <div className={`rounded-xl border p-4 ${paymentMethodsSecured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Payment Method Safety</p>
                                    <p className={`text-sm font-bold mt-1 ${paymentMethodsSecured ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        {paymentMethodsSecured ? 'Tokenized + Default' : 'Review Needed'}
                                    </p>
                                </div>
                            </div>

                            {!hasOtpReadyIdentity && (
                                <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700">
                                    Your account is verified but phone OTP readiness is incomplete. Add or correct your phone number to strengthen account security.
                                </div>
                            )}

                            {trustStatus.derivedStatus !== 'healthy' && (
                                <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700">
                                    Some live trust checks are degraded. You can continue safely, but use official support channels if you notice suspicious behavior.
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Link to="/security" className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 text-center">
                                    Open Security Policy
                                </Link>
                                <Link to="/privacy" className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 text-center">
                                    Open Privacy Policy
                                </Link>
                                <Link to="/contact" className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 text-center">
                                    Contact Support
                                </Link>
                                <button
                                    type="button"
                                    onClick={handlePasswordReset}
                                    disabled={passwordResetting}
                                    className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                                >
                                    {passwordResetting ? 'Sending...' : 'Send Reset Link'}
                                </button>
                            </div>
                        </div>

                        {/* Notifications */}
                        <div className="bg-white rounded-2xl border shadow-sm p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><Bell className="w-5 h-5 text-indigo-500" /> Notifications</h3>
                            <div className="space-y-3">
                                <TogglePref label="Order Updates" desc="Get notified about order status changes" defaultOn={true} />
                                <TogglePref label="Marketplace" desc="Notifications about your listings and offers" defaultOn={true} />
                                <TogglePref label="Promotions" desc="Sales, deals, and special offers" defaultOn={false} />
                                <TogglePref label="Newsletter" desc="Weekly curated product picks" defaultOn={false} />
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-6">
                            <h3 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Danger Zone</h3>
                            <div className="space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-red-50 rounded-xl">
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">Log Out</p>
                                        <p className="text-xs text-gray-400">Sign out of your account</p>
                                    </div>
                                    <button onClick={logout}
                                        className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-bold text-sm rounded-lg hover:bg-red-600 transition-colors">
                                        <LogOut className="w-4 h-4" /> Log Out
                                    </button>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-red-50 rounded-xl">
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">Delete Account</p>
                                        <p className="text-xs text-gray-400">Permanently remove your account and all data</p>
                                    </div>
                                    <button className="px-4 py-2 text-red-600 font-bold text-sm border border-red-300 rounded-lg hover:bg-red-50">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sub-components Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function StatCard({ icon: Icon, label, value, color }) {
    const colorMap = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        pink: 'bg-pink-50 text-pink-600',
        purple: 'bg-purple-50 text-purple-600',
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
        cyan: 'bg-cyan-50 text-cyan-600',
    };
    const iconColor = colorMap[color] || colorMap.blue;

    return (
        <div className="premium-stat-card premium-card-hover">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 ${iconColor}`}>
                <Icon className="w-5 h-5" />
            </div>
            <p className="mt-5 text-3xl font-black tracking-tight text-white">{value}</p>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
        </div>
    );
}

function QuickLink({ to, icon: Icon, label, desc }) {
    return (
        <Link to={to} className="premium-panel premium-card-hover group p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-6 h-6 transition-transform duration-300 group-hover:scale-110" />
            </div>
            <p className="mt-4 text-base font-black text-white">{label}</p>
            <p className="mt-1 text-sm text-slate-400">{desc}</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-neo-cyan">
                Open <ChevronRight className="w-4 h-4" />
            </div>
        </Link>
    );
}

function InfoRow({ icon: Icon, label, value, badge }) {
    return (
        <div className="profile-premium-info-row">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
                <div className="text-sm font-semibold text-white">{value || 'Not set'}</div>
            </div>
            {badge && <span className="premium-chip-muted mt-1 text-[10px] font-black uppercase tracking-[0.2em]">{badge}</span>}
        </div>
    );
}

function TogglePref({ label, desc, defaultOn }) {
    const [on, setOn] = useState(defaultOn);
    return (
        <div className="profile-premium-toggle-row">
            <div>
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-slate-400">{desc}</p>
            </div>
            <button onClick={() => setOn(!on)}
                className={cn('profile-premium-toggle', on && 'profile-premium-toggle-on')}>
                <div className={cn('profile-premium-toggle-thumb', on && 'profile-premium-toggle-thumb-on')} />
            </button>
        </div>
    );
}

