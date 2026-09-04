import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MapPin, Plus, Save, Phone, Edit3, Trash2 } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { EmptyState, SectionSkeleton } from './ProfileShared';
import { ADDRESS_PHONE_INPUT_PATTERN } from '../hooks/profileUtils';

const formatAddressType = (value, fallback, t) => {
    switch (String(value || '').toLowerCase()) {
        case 'home':
            return t('profile.addresses.type.home', {}, 'Home');
        case 'work':
            return t('profile.addresses.type.work', {}, 'Work');
        case 'other':
            return t('profile.addresses.type.other', {}, 'Other');
        default:
            return fallback || '';
    }
};

export default function AddressesSection({
    profile, ADDRESS_TYPES, showAddressForm, setShowAddressForm, editingAddress,
    addressForm, setAddressForm, saving, handleSaveAddress, resetAddressForm,
    startEditAddress, handleDeleteAddress, handleSetDefaultAddress, addressSubmitError,
    addressesLoading, addressesError, onRetryAddresses,
}) {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const formId = useId();
    const [deleteCandidate, setDeleteCandidate] = useState(null);
    const deleteDialogRef = useRef(null);
    const deleteCancelRef = useRef(null);
    const deleteTriggerRef = useRef(null);

    const closeDeleteDialog = useCallback(() => {
        setDeleteCandidate(null);
        window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
        if (!deleteCandidate) return undefined;
        deleteCancelRef.current?.focus();

        const handleDialogKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDeleteDialog();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(deleteDialogRef.current?.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ) || []);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleDialogKeyDown);
        return () => document.removeEventListener('keydown', handleDialogKeyDown);
    }, [closeDeleteDialog, deleteCandidate]);

    const addressTypes = ADDRESS_TYPES.map((type) => ({
        ...type,
        label: formatAddressType(type.value, type.label, t),
    }));

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-black text-white">{t('profile.addresses.title', {}, 'Saved Addresses')}</h2>
                <button
                    type="button"
                    onClick={() => {
                        resetAddressForm();
                        setShowAddressForm(true);
                    }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#d2a96c] px-5 py-2 text-sm font-bold text-[#17231e] transition-colors hover:bg-[#f3c982]"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" /> {t('profile.addresses.add', {}, 'Add Address')}
                </button>
            </div>

            {addressesLoading ? (
                <SectionSkeleton rows={2} label={t('profile.addresses.loading', {}, 'Loading saved addresses...')} />
            ) : null}

            {addressesError ? (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4">
                    <p className="text-sm font-semibold text-rose-200">{addressesError}</p>
                    <button
                        type="button"
                        onClick={onRetryAddresses}
                        className="rounded-xl border border-rose-400/20 bg-white/[0.04] px-3 py-1.5 text-sm font-bold text-rose-200 hover:bg-white/[0.08]"
                    >
                        {t('profile.addresses.retry', {}, 'Retry')}
                    </button>
                </div>
            ) : null}

            {showAddressForm ? (
                <form
                    className="premium-panel premium-card-hover p-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        handleSaveAddress();
                    }}
                    aria-describedby={addressSubmitError ? `${formId}-error` : undefined}
                >
                    <h3 className="mb-4 font-black text-white">
                        {editingAddress
                            ? t('profile.addresses.form.editTitle', {}, 'Edit Address')
                            : t('profile.addresses.form.newTitle', {}, 'New Address')}
                    </h3>

                    <div className="mb-4 flex gap-3">
                        {addressTypes.map((type) => {
                            const Icon = type.icon;
                            return (
                                <button
                                    type="button"
                                    key={type.value}
                                    onClick={() => setAddressForm((previous) => ({ ...previous, type: type.value }))}
                                    aria-pressed={addressForm.type === type.value}
                                    className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all
              ${addressForm.type === type.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
                                >
                                    <Icon className="h-4 w-4" /> {type.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="space-y-1 text-sm font-semibold text-slate-200" htmlFor={`${formId}-name`}>
                            {t('profile.personal.fullName', {}, 'Full Name')}
                        <input
                            id={`${formId}-name`}
                            name="name"
                            value={addressForm.name}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, name: event.target.value }))}
                            autoComplete="name"
                            required
                            minLength={2}
                            maxLength={80}
                            className="rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="space-y-1 text-sm font-semibold text-slate-200" htmlFor={`${formId}-phone`}>
                            {t('profile.personal.phone', {}, 'Phone Number')}
                        <input
                            id={`${formId}-phone`}
                            name="phone"
                            type="tel"
                            value={addressForm.phone}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, phone: event.target.value }))}
                            autoComplete="tel"
                            required
                            pattern={ADDRESS_PHONE_INPUT_PATTERN}
                            title={t('profile.addresses.form.phoneHint', {}, '10 to 15 digits; spaces, dashes and parentheses are allowed')}
                            className="rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="space-y-1 text-sm font-semibold text-slate-200 sm:col-span-2" htmlFor={`${formId}-street`}>
                            {t('profile.addresses.form.addressLabel', {}, 'Address')}
                        <textarea
                            id={`${formId}-street`}
                            name="street-address"
                            value={addressForm.address}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, address: event.target.value }))}
                            autoComplete="street-address"
                            required
                            minLength={5}
                            maxLength={200}
                            rows={2}
                            className="w-full resize-none rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="space-y-1 text-sm font-semibold text-slate-200" htmlFor={`${formId}-city`}>
                            {t('profile.addresses.form.cityPlaceholder', {}, 'City')}
                        <input
                            id={`${formId}-city`}
                            name="address-level2"
                            value={addressForm.city}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, city: event.target.value }))}
                            autoComplete="address-level2"
                            required
                            minLength={2}
                            maxLength={50}
                            className="rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="space-y-1 text-sm font-semibold text-slate-200" htmlFor={`${formId}-state`}>
                            {t('profile.addresses.form.statePlaceholder', {}, 'State')}
                        <input
                            id={`${formId}-state`}
                            name="address-level1"
                            value={addressForm.state}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, state: event.target.value }))}
                            autoComplete="address-level1"
                            required
                            minLength={2}
                            maxLength={50}
                            className="rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="space-y-1 text-sm font-semibold text-slate-200" htmlFor={`${formId}-pincode`}>
                            {t('profile.addresses.form.pincodePlaceholder', {}, 'PIN code')}
                        <input
                            id={`${formId}-pincode`}
                            name="postal-code"
                            value={addressForm.pincode}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, pincode: event.target.value }))}
                            autoComplete="postal-code"
                            inputMode="numeric"
                            pattern="[1-9][0-9]{5}"
                            required
                            maxLength={6}
                            className="rounded-xl border-2 border-white/10 bg-white/[0.04] p-3 text-white outline-none focus:border-cyan-300"
                        />
                        </label>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
                            <input
                                type="checkbox"
                                checked={addressForm.isDefault}
                                onChange={(event) => setAddressForm((previous) => ({ ...previous, isDefault: event.target.checked }))}
                                className="h-5 w-5 rounded text-indigo-600"
                            />
                            <span className="text-sm font-semibold text-slate-200">{t('profile.addresses.form.default', {}, 'Set as default')}</span>
                        </label>
                    </div>

                    {addressSubmitError ? (
                        <p id={`${formId}-error`} role="alert" className="mt-4 text-sm font-semibold text-red-700">
                            {addressSubmitError}
                        </p>
                    ) : null}

                    <div className="mt-5 flex gap-3">
                        <button
                            type="submit"
                            disabled={saving || !addressForm.name || !addressForm.phone || !addressForm.address || !addressForm.city || !addressForm.state || !addressForm.pincode}
                            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
                            {editingAddress
                                ? t('profile.addresses.form.update', {}, 'Update')
                                : t('profile.addresses.form.save', {}, 'Save')} {t('profile.addresses.form.addressLabel', {}, 'Address')}
                        </button>
                        <button
                            type="button"
                            onClick={resetAddressForm}
                            className="rounded-lg border px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
                        >
                            {t('profile.personal.cancel', {}, 'Cancel')}
                        </button>
                    </div>
                </form>
            ) : null}

            {(!profile?.addresses || profile.addresses.length === 0) && !showAddressForm ? (
                <EmptyState
                    icon={MapPin}
                    title={t('profile.addresses.empty.title', {}, 'No addresses saved')}
                    body={t('profile.addresses.empty.body', {}, 'Add your delivery address for faster checkout')}
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {profile?.addresses?.map((address) => {
                        const typeOption = addressTypes.find((type) => type.value === address.type);
                        const TypeIcon = typeOption?.icon || MapPin;

                        return (
                            <div key={address._id} className={`relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${address.isDefault ? 'ring-2 ring-[#d2a96c]/60' : ''}`}>
                                {address.isDefault ? (
                                    <span className="absolute right-3 top-3 rounded-full border border-[#d2a96c]/30 bg-[#d2a96c]/10 px-2 py-0.5 text-[10px] font-bold text-[#f3c982]">
                                        {t('profile.addresses.defaultBadge', {}, 'DEFAULT')}
                                    </span>
                                ) : null}
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-[#d2a96c]">
                                        <TypeIcon className="h-4 w-4" aria-hidden="true" />
                                    </div>
                                    <span className="font-bold capitalize text-white">{typeOption?.label || address.type}</span>
                                </div>
                                <p className="font-semibold text-white">{address.name}</p>
                                <p className="mt-1 text-sm text-slate-300">{address.address}</p>
                                <p className="text-sm text-slate-300">{address.city}, {address.state} - {address.pincode}</p>
                                <p className="mt-1 flex items-center gap-1 text-sm text-slate-400"><Phone className="h-3 w-3" aria-hidden="true" /> {address.phone}</p>
                                <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                                    <button
                                        type="button"
                                        onClick={() => startEditAddress(address)}
                                        className="flex items-center gap-1 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
                                    >
                                        <Edit3 className="h-3 w-3" aria-hidden="true" /> {t('profile.personal.edit', {}, 'Edit')}
                                    </button>
                                    {!address.isDefault ? (
                                        <button
                                            type="button"
                                            onClick={() => handleSetDefaultAddress(address)}
                                            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/[0.08]"
                                        >
                                            {t('profile.addresses.makeDefault', {}, 'Make default')}
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            deleteTriggerRef.current = event.currentTarget;
                                            setDeleteCandidate(address);
                                        }}
                                        className="flex items-center gap-1 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/20"
                                    >
                                        <Trash2 className="h-3 w-3" aria-hidden="true" /> {t('profile.addresses.delete', {}, 'Delete')}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {deleteCandidate ? (
                <div
                    className="account-dialog-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeDeleteDialog();
                    }}
                >
                    <div
                        ref={deleteDialogRef}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={`${formId}-delete-title`}
                        aria-describedby={`${formId}-delete-body`}
                        className="account-dialog rounded-xl border border-red-200 bg-red-50 p-5"
                    >
                        <h2 id={`${formId}-delete-title`} className="font-bold text-gray-950">
                            {t('profile.addresses.deleteConfirm.title', {}, 'Delete this saved address?')}
                        </h2>
                        <p id={`${formId}-delete-body`} className="mt-2 text-sm text-gray-700">
                            {t(
                                'profile.addresses.deleteConfirm.body',
                                {},
                                'Past orders keep their delivery copy. Future checkouts will no longer offer this address.'
                            )}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                            <button
                                ref={deleteCancelRef}
                                type="button"
                                onClick={closeDeleteDialog}
                                disabled={saving}
                                className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 disabled:opacity-50"
                            >
                                {t('profile.addresses.deleteConfirm.cancel', {}, 'Keep address')}
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={async () => {
                                    const deleted = await handleDeleteAddress(deleteCandidate._id);
                                    if (deleted) closeDeleteDialog();
                                }}
                                className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
                            >
                                {t('profile.addresses.deleteConfirm.confirm', {}, 'Delete address')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
