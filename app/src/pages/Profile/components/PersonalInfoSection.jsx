import { BadgeCheck, Calendar, Edit3, Mail, Phone, Save, Star, User } from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { InfoRow } from './ProfileShared';

const accountCopy = {
    active: 'Account is fully active.',
    warned: 'There is an active warning on this account.',
    suspended: 'Key account actions are restricted while suspended.',
    deleted: 'This account is in the deletion pipeline.',
};

export default function PersonalInfoSection({
    profile,
    profileName,
    profileEmail,
    profilePhone,
    editMode,
    setEditMode,
    editForm,
    setEditForm,
    saving,
    handleSaveProfile,
    createEditForm,
    memberSince,
    hasOtpReadyIdentity,
    paymentMethodsSecured,
    trustHealthy,
    profileCompletion,
    isAdminAccount,
    accountState,
}) {
    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_20rem]">
            <div className="premium-panel p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-black text-white">Personal Information</h3>
                        <p className="text-sm text-slate-400 mt-1">Core identity details, bio, and member-facing profile signals.</p>
                    </div>
                    {editMode ? (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setEditMode(false);
                                    setEditForm(createEditForm(profile));
                                }}
                                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveProfile}
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-sm font-black text-[#051018] disabled:opacity-60"
                            >
                                {saving ? <div className="w-4 h-4 border-2 border-[#051018] border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setEditMode(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                        >
                            <Edit3 className="w-4 h-4" /> Edit
                        </button>
                    )}
                </div>

                <div className="space-y-5">
                    <InfoRow
                        icon={User}
                        label="Full Name"
                        value={editMode ? (
                            <input
                                value={editForm.name}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, name: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profileName || 'Not set'
                        )}
                    />

                    <InfoRow icon={Mail} label="Email Address" value={profileEmail || 'Not set'} badge="Managed by auth" />

                    <InfoRow
                        icon={Phone}
                        label="Phone Number"
                        value={editMode ? (
                            <input
                                value={editForm.phone}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, phone: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profilePhone || 'Not set'
                        )}
                        badge={hasOtpReadyIdentity ? 'OTP ready' : 'Needs verification'}
                    />

                    <InfoRow
                        icon={User}
                        label="Gender"
                        value={editMode ? (
                            <PremiumSelect
                                value={editForm.gender}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, gender: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            >
                                <option value="">Prefer not to say</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </PremiumSelect>
                        ) : (
                            profile?.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : 'Not specified'
                        )}
                    />

                    <InfoRow
                        icon={Calendar}
                        label="Date of Birth"
                        value={editMode ? (
                            <input
                                type="date"
                                value={editForm.dob}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, dob: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profile?.dob ? new Date(profile.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set'
                        )}
                    />

                    <InfoRow
                        icon={Edit3}
                        label="Bio"
                        value={editMode ? (
                            <textarea
                                value={editForm.bio}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, bio: event.target.value }))}
                                maxLength={200}
                                rows={4}
                                placeholder="Tell Aura what matters about you..."
                                className="w-full rounded-[1.6rem] border border-white/10 bg-white/5 px-4 py-4 text-white outline-none resize-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profile?.bio || 'No bio added yet'
                        )}
                    />
                </div>
            </div>

            <div className="space-y-4">
                <div className="premium-panel p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Profile readiness</p>
                    <p className="mt-2 text-3xl font-black text-white">{profileCompletion}%</p>
                    <p className="mt-2 text-sm text-slate-400">Member since {memberSince}. Use this section to keep your identity, reachability, and trust posture complete.</p>
                </div>

                <div className="premium-panel p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Account posture</p>
                    <div className="mt-3 space-y-3 text-sm">
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">Identity</span>
                            <span className={hasOtpReadyIdentity ? 'text-emerald-200 font-bold' : 'text-amber-100 font-bold'}>
                                {hasOtpReadyIdentity ? 'Fortified' : 'Needs work'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">Payments</span>
                            <span className={paymentMethodsSecured ? 'text-emerald-200 font-bold' : 'text-amber-100 font-bold'}>
                                {paymentMethodsSecured ? 'Tokenized' : 'Unsecured'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">Trust checks</span>
                            <span className={trustHealthy ? 'text-emerald-200 font-bold' : 'text-amber-100 font-bold'}>
                                {trustHealthy ? 'Healthy' : 'Degraded'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="premium-panel p-5">
                    <div className="flex flex-wrap items-center gap-2">
                        {isAdminAccount ? (
                            <span className="premium-chip text-[10px] font-black uppercase tracking-[0.18em] border-amber-400/25 bg-amber-500/12 text-amber-100">
                                <Star className="w-3 h-3" /> Admin
                            </span>
                        ) : null}
                        <span className={`premium-chip text-[10px] font-black uppercase tracking-[0.18em] ${hasOtpReadyIdentity ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200' : 'border-amber-400/25 bg-amber-500/12 text-amber-100'}`}>
                            <BadgeCheck className="w-3 h-3" />
                            {hasOtpReadyIdentity ? 'Verified' : 'Partially verified'}
                        </span>
                    </div>
                    <p className="mt-4 text-sm text-slate-300">{accountCopy[accountState] || accountCopy.active}</p>
                    <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Surface note</p>
                        <p className="mt-2 text-sm text-slate-300">
                            This tab is your identity layer. Rewards, support, governance, and notifications depend on these details being real and current.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
