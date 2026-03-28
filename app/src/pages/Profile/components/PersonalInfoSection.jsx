import { BadgeCheck, Calendar, Edit3, Mail, Phone, Save, Star, User } from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { InfoRow } from './ProfileShared';

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
    const { t } = useMarket();

    const accountCopy = {
        active: t('profile.personal.account.active', {}, 'Account is fully active.'),
        warned: t('profile.personal.account.warned', {}, 'There is an active warning on this account.'),
        suspended: t('profile.personal.account.suspended', {}, 'Key account actions are restricted while suspended.'),
        deleted: t('profile.personal.account.deleted', {}, 'This account is in the deletion pipeline.'),
    };

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_20rem]">
            <div className="premium-panel p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-xl font-black text-white">{t('profile.personal.title', {}, 'Personal Information')}</h3>
                        <p className="mt-1 text-sm text-slate-400">{t('profile.personal.body', {}, 'Core identity details, bio, and member-facing profile signals.')}</p>
                    </div>
                    {editMode ? (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setEditMode(false);
                                    setEditForm(createEditForm(profile));
                                }}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"
                            >
                                {t('profile.personal.cancel', {}, 'Cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveProfile}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-2 text-sm font-black text-[#051018] disabled:opacity-60"
                            >
                                {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#051018] border-t-transparent" /> : <Save className="h-4 w-4" />}
                                {t('profile.personal.save', {}, 'Save')}
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setEditMode(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                        >
                            <Edit3 className="h-4 w-4" /> {t('profile.personal.edit', {}, 'Edit')}
                        </button>
                    )}
                </div>

                <div className="space-y-5">
                    <InfoRow
                        icon={User}
                        label={t('profile.personal.fullName', {}, 'Full Name')}
                        value={editMode ? (
                            <input
                                value={editForm.name}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, name: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profileName || t('profile.shared.notSet', {}, 'Not set')
                        )}
                    />

                    <InfoRow
                        icon={Mail}
                        label={t('profile.personal.email', {}, 'Email Address')}
                        value={profileEmail || t('profile.shared.notSet', {}, 'Not set')}
                        badge={t('profile.personal.authManaged', {}, 'Managed by auth')}
                    />

                    <InfoRow
                        icon={Phone}
                        label={t('profile.personal.phone', {}, 'Phone Number')}
                        value={editMode ? (
                            <input
                                value={editForm.phone}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, phone: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profilePhone || t('profile.shared.notSet', {}, 'Not set')
                        )}
                        badge={hasOtpReadyIdentity
                            ? t('profile.personal.otpReady', {}, 'OTP ready')
                            : t('profile.personal.needsVerification', {}, 'Needs verification')}
                    />

                    <InfoRow
                        icon={User}
                        label={t('profile.personal.gender', {}, 'Gender')}
                        value={editMode ? (
                            <PremiumSelect
                                value={editForm.gender}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, gender: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            >
                                <option value="">{t('profile.personal.gender.preferNot', {}, 'Prefer not to say')}</option>
                                <option value="male">{t('profile.personal.gender.male', {}, 'Male')}</option>
                                <option value="female">{t('profile.personal.gender.female', {}, 'Female')}</option>
                                <option value="other">{t('profile.personal.gender.other', {}, 'Other')}</option>
                            </PremiumSelect>
                        ) : (
                            profile?.gender
                                ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)
                                : t('profile.personal.gender.unspecified', {}, 'Not specified')
                        )}
                    />

                    <InfoRow
                        icon={Calendar}
                        label={t('profile.personal.dob', {}, 'Date of Birth')}
                        value={editMode ? (
                            <input
                                type="date"
                                value={editForm.dob}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, dob: event.target.value }))}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profile?.dob ? new Date(profile.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : t('profile.shared.notSet', {}, 'Not set')
                        )}
                    />

                    <InfoRow
                        icon={Edit3}
                        label={t('profile.personal.bio', {}, 'Bio')}
                        value={editMode ? (
                            <textarea
                                value={editForm.bio}
                                onChange={(event) => setEditForm((previous) => ({ ...previous, bio: event.target.value }))}
                                maxLength={200}
                                rows={4}
                                placeholder={t('profile.personal.bioPlaceholder', {}, 'Tell Aura what matters about you...')}
                                className="w-full resize-none rounded-[1.6rem] border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-colors focus:border-cyan-300/30"
                            />
                        ) : (
                            profile?.bio || t('profile.personal.noBio', {}, 'No bio added yet')
                        )}
                    />
                </div>
            </div>

            <div className="space-y-4">
                <div className="premium-panel p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('profile.personal.readiness.label', {}, 'Profile readiness')}</p>
                    <p className="mt-2 text-3xl font-black text-white">{profileCompletion}%</p>
                    <p className="mt-2 text-sm text-slate-400">
                        {t('profile.personal.readiness.body', { memberSince }, `Member since ${memberSince}. Use this section to keep your identity, reachability, and trust posture complete.`)}
                    </p>
                </div>

                <div className="premium-panel p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('profile.personal.posture.label', {}, 'Account posture')}</p>
                    <div className="mt-3 space-y-3 text-sm">
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">{t('profile.personal.posture.identity', {}, 'Identity')}</span>
                            <span className={hasOtpReadyIdentity ? 'font-bold text-emerald-200' : 'font-bold text-amber-100'}>
                                {hasOtpReadyIdentity ? t('profile.personal.posture.fortified', {}, 'Fortified') : t('profile.personal.posture.needsWork', {}, 'Needs work')}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">{t('profile.personal.posture.payments', {}, 'Payments')}</span>
                            <span className={paymentMethodsSecured ? 'font-bold text-emerald-200' : 'font-bold text-amber-100'}>
                                {paymentMethodsSecured ? t('profile.personal.posture.tokenized', {}, 'Tokenized') : t('profile.personal.posture.unsecured', {}, 'Unsecured')}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-slate-400">{t('profile.personal.posture.trust', {}, 'Trust checks')}</span>
                            <span className={trustHealthy ? 'font-bold text-emerald-200' : 'font-bold text-amber-100'}>
                                {trustHealthy ? t('profile.personal.posture.healthy', {}, 'Healthy') : t('profile.personal.posture.degraded', {}, 'Degraded')}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="premium-panel p-5">
                    <div className="flex flex-wrap items-center gap-2">
                        {isAdminAccount ? (
                            <span className="premium-chip border-amber-400/25 bg-amber-500/12 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100">
                                <Star className="h-3 w-3" /> {t('profile.personal.admin', {}, 'Admin')}
                            </span>
                        ) : null}
                        <span className={`premium-chip text-[10px] font-black uppercase tracking-[0.18em] ${hasOtpReadyIdentity ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200' : 'border-amber-400/25 bg-amber-500/12 text-amber-100'}`}>
                            <BadgeCheck className="h-3 w-3" />
                            {hasOtpReadyIdentity ? t('profile.personal.verified', {}, 'Verified') : t('profile.personal.partiallyVerified', {}, 'Partially verified')}
                        </span>
                    </div>
                    <p className="mt-4 text-sm text-slate-300">{accountCopy[accountState] || accountCopy.active}</p>
                    <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('profile.personal.surfaceNote.label', {}, 'Surface note')}</p>
                        <p className="mt-2 text-sm text-slate-300">
                            {t('profile.personal.surfaceNote.body', {}, 'This tab is your identity layer. Rewards, support, governance, and notifications depend on these details being real and current.')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
