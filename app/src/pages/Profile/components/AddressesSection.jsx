import { MapPin, Plus, Save, Phone, Edit3, Trash2 } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';

export default function AddressesSection({
    profile, ADDRESS_TYPES, showAddressForm, setShowAddressForm, editingAddress,
    addressForm, setAddressForm, saving, handleSaveAddress, resetAddressForm,
    startEditAddress, handleDeleteAddress,
}) {
    const { t } = useMarket();

    const addressTypes = ADDRESS_TYPES.map((type) => ({
        ...type,
        label: t(`profile.addresses.type.${type.value}`, {}, type.label),
    }));

    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-bold text-gray-900">{t('profile.addresses.title', {}, 'Saved Addresses')}</h3>
                <button
                    onClick={() => {
                        resetAddressForm();
                        setShowAddressForm(true);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-700"
                >
                    <Plus className="h-4 w-4" /> {t('profile.addresses.add', {}, 'Add Address')}
                </button>
            </div>

            {showAddressForm ? (
                <div className="rounded-2xl border bg-white p-6 shadow-sm">
                    <h4 className="mb-4 font-bold text-gray-900">
                        {editingAddress
                            ? t('profile.addresses.form.editTitle', {}, 'Edit Address')
                            : t('profile.addresses.form.newTitle', {}, 'New Address')}
                    </h4>

                    <div className="mb-4 flex gap-3">
                        {addressTypes.map((type) => {
                            const Icon = type.icon;
                            return (
                                <button
                                    key={type.value}
                                    onClick={() => setAddressForm((previous) => ({ ...previous, type: type.value }))}
                                    className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all
              ${addressForm.type === type.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
                                >
                                    <Icon className="h-4 w-4" /> {type.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <input
                            value={addressForm.name}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, name: event.target.value }))}
                            placeholder={t('profile.addresses.form.namePlaceholder', {}, 'Full Name *')}
                            className="rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500"
                        />
                        <input
                            value={addressForm.phone}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, phone: event.target.value }))}
                            placeholder={t('profile.addresses.form.phonePlaceholder', {}, 'Phone Number *')}
                            className="rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500"
                        />
                        <textarea
                            value={addressForm.address}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, address: event.target.value }))}
                            placeholder={t('profile.addresses.form.addressPlaceholder', {}, 'Full Address *')}
                            rows={2}
                            className="resize-none rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500 sm:col-span-2"
                        />
                        <input
                            value={addressForm.city}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, city: event.target.value }))}
                            placeholder={t('profile.addresses.form.cityPlaceholder', {}, 'City *')}
                            className="rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500"
                        />
                        <input
                            value={addressForm.state}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, state: event.target.value }))}
                            placeholder={t('profile.addresses.form.statePlaceholder', {}, 'State *')}
                            className="rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500"
                        />
                        <input
                            value={addressForm.pincode}
                            onChange={(event) => setAddressForm((previous) => ({ ...previous, pincode: event.target.value }))}
                            placeholder={t('profile.addresses.form.pincodePlaceholder', {}, 'Pincode *')}
                            maxLength={6}
                            className="rounded-xl border-2 border-gray-200 p-3 outline-none focus:border-indigo-500"
                        />
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
                            <input
                                type="checkbox"
                                checked={addressForm.isDefault}
                                onChange={(event) => setAddressForm((previous) => ({ ...previous, isDefault: event.target.checked }))}
                                className="h-5 w-5 rounded text-indigo-600"
                            />
                            <span className="text-sm font-semibold text-gray-700">{t('profile.addresses.form.default', {}, 'Set as default')}</span>
                        </label>
                    </div>

                    <div className="mt-5 flex gap-3">
                        <button
                            onClick={handleSaveAddress}
                            disabled={saving || !addressForm.name || !addressForm.phone || !addressForm.address || !addressForm.city || !addressForm.state || !addressForm.pincode}
                            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
                            {editingAddress
                                ? t('profile.addresses.form.update', {}, 'Update')
                                : t('profile.addresses.form.save', {}, 'Save')} {t('profile.addresses.form.addressLabel', {}, 'Address')}
                        </button>
                        <button
                            onClick={resetAddressForm}
                            className="rounded-lg border px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
                        >
                            {t('profile.personal.cancel', {}, 'Cancel')}
                        </button>
                    </div>
                </div>
            ) : null}

            {(!profile?.addresses || profile.addresses.length === 0) && !showAddressForm ? (
                <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
                    <MapPin className="mx-auto mb-3 h-16 w-16 text-gray-200" />
                    <h3 className="mb-1 text-lg font-bold text-gray-900">{t('profile.addresses.empty.title', {}, 'No addresses saved')}</h3>
                    <p className="text-sm text-gray-400">{t('profile.addresses.empty.body', {}, 'Add your delivery address for faster checkout')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {profile?.addresses?.map((address) => {
                        const typeOption = addressTypes.find((type) => type.value === address.type);
                        const TypeIcon = typeOption?.icon || MapPin;

                        return (
                            <div key={address._id} className={`relative rounded-2xl border bg-white p-5 shadow-sm ${address.isDefault ? 'ring-2 ring-indigo-500' : ''}`}>
                                {address.isDefault ? (
                                    <span className="absolute right-3 top-3 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                                        {t('profile.addresses.defaultBadge', {}, 'DEFAULT')}
                                    </span>
                                ) : null}
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
                                        <TypeIcon className="h-4 w-4 text-indigo-600" />
                                    </div>
                                    <span className="font-bold capitalize text-gray-900">{typeOption?.label || address.type}</span>
                                </div>
                                <p className="font-semibold text-gray-900">{address.name}</p>
                                <p className="mt-1 text-sm text-gray-600">{address.address}</p>
                                <p className="text-sm text-gray-600">{address.city}, {address.state} - {address.pincode}</p>
                                <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><Phone className="h-3 w-3" /> {address.phone}</p>
                                <div className="mt-3 flex gap-2 border-t pt-3">
                                    <button
                                        onClick={() => startEditAddress(address)}
                                        className="flex items-center gap-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                                    >
                                        <Edit3 className="h-3 w-3" /> {t('profile.personal.edit', {}, 'Edit')}
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAddress(address._id)}
                                        className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50"
                                    >
                                        <Trash2 className="h-3 w-3" /> {t('profile.addresses.delete', {}, 'Delete')}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
