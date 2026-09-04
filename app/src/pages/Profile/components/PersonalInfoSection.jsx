import { BadgeCheck, Calendar, Edit3, Mail, Phone, Save, Star, User } from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { InfoRow } from './ProfileShared';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

export default function PersonalInfoSection({
    profile,
    profileName,
    profileEmail,
    profilePhone,
    editMode,
    setEditMode,
    onCancelEdit,
    editForm,
    handleProfileFieldChange,
    handleProfileFieldBlur,
    saving,
    handleSaveProfile,
    profileDirty,
    profileFieldErrors,
    profileSubmitError,
    profileRequiresReauth,
    onReauthenticate,
    memberSince,
    hasOtpReadyIdentity,
    paymentMethodsSecured,
    trustHealthy,
    profileCompletion,
    isAdminAccount,
    accountState,
}) {
    const { t: legacyT, formatDateTime } = useMarket();
    const t = useStableIcuMessages(legacyT);

    const accountCopy = {
        active: t('profile.personal.account.active', {}, 'Account is fully active.'),
        warned: t('profile.personal.account.warned', {}, 'There is an active warning on this account.'),
        suspended: t('profile.personal.account.suspended', {}, 'Key account actions are restricted while suspended.'),
        deleted: t('profile.personal.account.deleted', {}, 'This account is in the deletion pipeline.'),
    };

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_20rem]">
            <form className="premium-panel p-6" onSubmit={handleSaveProfile} noValidate>
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-black text-white">{t('profile.personal.title', {}, 'Personal Information')}</h2>
                        <p className="mt-1 text-sm text-slate-400">{t('profile.personal.body', {}, 'Core identity details, bio, and member-facing profile signals.')}</p>
                    </div>
                    {editMode ? (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onCancelEdit}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"
                            >
                                {t('profile.personal.cancel', {}, 'Cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !profileDirty}
                                aria-describedby={saving || !profileDirty ? 'account-profile-save-hint' : undefined}
                                title={saving
                                    ? t('profile.personal.savingHint', {}, 'Saving your profile…')
                                    : t('profile.personal.noChangesHint', {}, 'Make a change before saving')}
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

                {saving || !profileDirty ? (
                    <p id="account-profile-save-hint" className="sr-only">
                        {saving
                            ? t('profile.personal.savingHint', {}, 'Saving your profile…')
                            : t('profile.personal.noChangesHint', {}, 'Make a change before saving')}
                    </p>
                ) : null}

                {profileSubmitError ? (
                    <div className="mb-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
                        <p>{profileSubmitError}</p>
                        {profileRequiresReauth ? (
                            <button
                                type="button"
                                onClick={onReauthenticate}
                                className="mt-3 rounded-xl border border-rose-300/25 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white"
                            >
                                {t('profile.personal.reauthenticate', {}, 'Verify identity and continue')}
                            </button>
                        ) : null}
                    </div>
                ) : null}

                <div className="space-y-5">
                    <InfoRow
                        icon={User}
                        label={t('profile.personal.fullName', {}, 'Full Name')}
                        value={editMode ? (
                            <div>
                                <input
                                    id="account-profile-name"
                                    value={editForm.name}
                                    onChange={(event) => handleProfileFieldChange('name', event.target.value)}
                                    onBlur={() => handleProfileFieldBlur('name')}
                                    autoComplete="name"
                                    maxLength={50}
                                    aria-label={t('profile.personal.fullName', {}, 'Full Name')}
                                    aria-invalid={Boolean(profileFieldErrors.name)}
                                    aria-describedby={profileFieldErrors.name ? 'account-profile-name-error' : undefined}
                                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                                />
                                {profileFieldErrors.name ? <p id="account-profile-name-error" className="mt-2 text-xs text-rose-200">{profileFieldErrors.name}</p> : null}
                            </div>
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
                            <div>
                                <input
                                    id="account-profile-phone"
                                    type="tel"
                                    value={editForm.phone}
                                    onChange={(event) => handleProfileFieldChange('phone', event.target.value)}
                                    onBlur={() => handleProfileFieldBlur('phone')}
                                    autoComplete="tel"
                                    inputMode="tel"
                                    aria-label={t('profile.personal.phone', {}, 'Phone Number')}
                                    aria-invalid={Boolean(profileFieldErrors.phone)}
                                    aria-describedby={profileFieldErrors.phone ? 'account-profile-phone-error' : undefined}
                                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                                />
                                {profileFieldErrors.phone ? <p id="account-profile-phone-error" className="mt-2 text-xs text-rose-200">{profileFieldErrors.phone}</p> : null}
                            </div>
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
                                id="account-profile-gender"
                                value={editForm.gender}
                                onChange={(event) => handleProfileFieldChange('gender', event.target.value)}
                                aria-label={t('profile.personal.gender', {}, 'Gender')}
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
                            <div>
                                <input
                                    id="account-profile-dob"
                                    type="date"
                                    value={editForm.dob}
                                    max={new Date().toISOString().slice(0, 10)}
                                    onChange={(event) => handleProfileFieldChange('dob', event.target.value)}
                                    onBlur={() => handleProfileFieldBlur('dob')}
                                    autoComplete="bday"
                                    aria-label={t('profile.personal.dob', {}, 'Date of Birth')}
                                    aria-invalid={Boolean(profileFieldErrors.dob)}
                                    aria-describedby={profileFieldErrors.dob ? 'account-profile-dob-error' : undefined}
                                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-300/30"
                                />
                                {profileFieldErrors.dob ? <p id="account-profile-dob-error" className="mt-2 text-xs text-rose-200">{profileFieldErrors.dob}</p> : null}
                            </div>
                        ) : (
                            profile?.dob ? formatDateTime(profile.dob, undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : t('profile.shared.notSet', {}, 'Not set')
                        )}
                    />

                    <InfoRow
                        icon={Edit3}
                        label={t('profile.personal.bio', {}, 'Bio')}
                        value={editMode ? (
                            <div>
                                <textarea
                                    id="account-profile-bio"
                                    value={editForm.bio}
                                    onChange={(event) => handleProfileFieldChange('bio', event.target.value)}
                                    onBlur={() => handleProfileFieldBlur('bio')}
                                    maxLength={200}
                                    rows={4}
                                    aria-label={t('profile.personal.bio', {}, 'Bio')}
                                    aria-invalid={Boolean(profileFieldErrors.bio)}
                                    aria-describedby="account-profile-bio-help"
                                    placeholder={t('profile.personal.bioPlaceholder', {}, 'Tell Aura what matters about you...')}
                                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-colors focus:border-cyan-300/30"
                                />
                                <p id="account-profile-bio-help" className={`mt-2 text-xs ${profileFieldErrors.bio ? 'text-rose-200' : 'text-slate-400'}`}>
                                    {profileFieldErrors.bio || t(
                                        'profile.personal.bioCount',
                                        { count: editForm.bio?.length || 0 },
                                        `${editForm.bio?.length || 0} of 200 characters`,
                                    )}
                                </p>
                            </div>
                        ) : (
                            profile?.bio || t('profile.personal.noBio', {}, 'No bio added yet')
                        )}
                    />
                </div>
            </form>

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
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
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
