import { useState, useEffect, useContext, useRef } from 'react';
import { Camera, Check, AlertTriangle, Shield, Calendar, Edit3, Package, Star, Store, BarChart3, User, MapPin, Sparkles, CreditCard, Settings } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { paymentApi, trustApi, userApi, intelligenceApi } from '@/services/api';
import { cn } from '@/lib/utils';

// Sub-components
import OverviewSection from './components/OverviewSection';
import PersonalInfoSection from './components/PersonalInfoSection';
import AddressesSection from './components/AddressesSection';
import OrdersSection from './components/OrdersSection';
import RewardsSection from './components/RewardsSection';
import ListingsSection from './components/ListingsSection';
import PaymentsSection from './components/PaymentsSection';
import SettingsSection from './components/SettingsSection';

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
    { value: 'home', label: 'Home', icon: MapPin },
    { value: 'work', label: 'Work', icon: MapPin }, // Simplified icon for mapping back
    { value: 'other', label: 'Other', icon: MapPin },
];

const PHONE_REGEX = /^\+?\d{10,15}$/;
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
    const [trustStatus, setTrustStatus] = useState({ derivedStatus: 'healthy' });
    const [trustLoading, setTrustLoading] = useState(false);
    const [intelligenceData, setIntelligenceData] = useState(null);
    const [intelligenceLoading, setIntelligenceLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);

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

    useEffect(() => {
        if (!currentUser?.email) return;
        (async () => {
            try {
                const [profileData, dashData] = await Promise.all([
                    userApi.getProfile({ firebaseUser: currentUser }),
                    userApi.getDashboard()
                ]);
                setProfile(profileData);
                setDashboard(dashData);
                setEditForm(createEditForm(profileData));
            } catch (err) {
                console.error('Profile fetch failed:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [currentUser?.email]);

    const showMsg = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    };

    const handleSaveProfile = async () => {
        setSaving(true);
        try {
            const updated = await userApi.updateProfile(editForm);
            setProfile(prev => ({ ...prev, ...updated }));
            setEditMode(false);
            showMsg('success', 'Profile updated!');
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const updated = await userApi.updateProfile({ avatar: reader.result });
                setProfile(prev => ({ ...prev, avatar: updated.avatar }));
                showMsg('success', 'Avatar updated!');
            } catch (err) {
                showMsg('error', err.message);
            }
        };
        reader.readAsDataURL(file);
    };

    const resetAddressForm = () => {
        setAddressForm({ type: 'home', name: '', phone: '', address: '', city: '', state: '', pincode: '', isDefault: false });
        setEditingAddress(null);
        setShowAddressForm(false);
    };

    const handleSaveAddress = async () => {
        setSaving(true);
        try {
            const result = editingAddress 
                ? await userApi.updateAddress(editingAddress, addressForm)
                : await userApi.addAddress(addressForm);
            setProfile(prev => ({ ...prev, addresses: result.addresses }));
            resetAddressForm();
            showMsg('success', 'Address saved!');
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAddress = async (id) => {
        if (!confirm('Delete address?')) return;
        try {
            const result = await userApi.deleteAddress(id);
            setProfile(prev => ({ ...prev, addresses: result.addresses }));
            showMsg('success', 'Address deleted');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handlePasswordReset = async () => {
        setPasswordResetting(true);
        try {
            await forgotPassword(profile?.email || currentUser?.email);
            showMsg('success', 'Reset link sent!');
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setPasswordResetting(false);
        }
    };

    if (loading) return <div className="p-20 text-center text-white">Loading Aura Identity...</div>;

    const stats = dashboard?.stats || {};
    const auraPoints = Number(profile?.loyalty?.pointsBalance || 0);
    const profileName = profile?.name || currentUser?.displayName || '';
    const initials = profileName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    return (
        <div className="min-h-screen profile-theme profile-premium-shell">
            {message.text && (
                <div className={cn('fixed top-4 right-4 z-50 px-5 py-3 rounded-2xl border shadow-xl animate-slide-in', 
                    message.type === 'success' ? 'bg-emerald-500/15 text-emerald-50' : 'bg-rose-500/15 text-rose-50')}>
                    {message.text}
                </div>
            )}

            <div className="max-w-7xl mx-auto px-4 pt-8">
                <div className="profile-premium-hero flex flex-col md:flex-row items-center gap-8">
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <div className="w-32 h-32 rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
                            {profile?.avatar ? <img src={profile.avatar} className="w-full h-full object-cover" /> : 
                            <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white">{initials}</div>}
                        </div>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleAvatarChange} />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-5xl md:text-8xl font-black text-white tracking-tighter uppercase">{profileName}</h1>
                        <p className="text-2xl md:text-5xl text-slate-400 mt-2 font-medium lowercase">{profile?.email}</p>
                        <div className="mt-10 flex flex-wrap gap-6">
                            <button onClick={() => setActiveTab('personal')} 
                                className="px-10 py-5 bg-gradient-to-r from-orange-500 via-pink-500 to-red-500 text-white text-4xl font-bold rounded-xl shadow-2xl transition-all hover:scale-105 active:scale-95">
                                Edit Profile
                            </button>
                            <button onClick={logout} 
                                className="px-10 py-5 bg-[#121212]/80 border-4 border-zinc-800 text-rose-400 text-4xl font-bold rounded-[2rem] hover:bg-zinc-800 transition-all active:scale-95">
                                Logout
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex gap-2 overflow-x-auto pb-4">
                    {TABS.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={cn('profile-premium-tab-pill', activeTab === tab.id && 'profile-premium-tab-pill-active')}>
                            <tab.icon className="w-4 h-4" /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="py-8">
                    {activeTab === 'overview' && <OverviewSection stats={stats} cartItems={cartItems} wishlistItems={wishlistItems} recentOrders={dashboard?.recentOrders || []} auraPoints={auraPoints} auraTier={profile?.loyalty?.tier || 'Rookie'} isAdminAccount={profile?.isAdmin} />}
                    {activeTab === 'personal' && <PersonalInfoSection profile={profile} profileName={profileName} profileEmail={profile?.email} profilePhone={profile?.phone} editMode={editMode} setEditMode={setEditMode} editForm={editForm} setEditForm={setEditForm} saving={saving} handleSaveProfile={handleSaveProfile} createEditForm={createEditForm} />}
                    {activeTab === 'addresses' && <AddressesSection profile={profile} ADDRESS_TYPES={ADDRESS_TYPES} showAddressForm={showAddressForm} setShowAddressForm={setShowAddressForm} editingAddress={editingAddress} addressForm={addressForm} setAddressForm={setAddressForm} saving={saving} handleSaveAddress={handleSaveAddress} resetAddressForm={resetAddressForm} startEditAddress={(a) => { setAddressForm(a); setEditingAddress(a._id); setShowAddressForm(true); }} handleDeleteAddress={handleDeleteAddress} />}
                    {activeTab === 'orders' && <OrdersSection recentOrders={dashboard?.recentOrders || []} stats={stats} />}
                    {activeTab === 'rewards' && <RewardsSection auraTier={profile?.loyalty?.tier} auraPoints={auraPoints} rewardSnapshot={profile?.loyalty || {}} nextMilestone={profile?.loyalty?.nextMilestone} handleOptimizeRewards={() => {}} optimizing={false} intelligenceLoading={false} intelligenceData={null} rewardActivity={[]} rewardsLoading={false} />}
                    {activeTab === 'listings' && <ListingsSection stats={stats} />}
                    {activeTab === 'payments' && <PaymentsSection paymentMethodsLoading={false} paymentMethods={[]} handleSetDefaultMethod={() => {}} handleDeletePaymentMethod={() => {}} />}
                    {activeTab === 'settings' && <SettingsSection profile={profile} currentUser={currentUser} handlePasswordReset={handlePasswordReset} passwordResetting={passwordResetting} hasOtpReadyIdentity={true} trustHealthy={true} trustLoading={false} paymentMethodsSecured={true} logout={logout} />}
                </div>
            </div>
        </div>
    );
}
