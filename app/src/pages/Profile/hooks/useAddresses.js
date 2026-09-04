import { useCallback, useState } from 'react';
import { userApi } from '@/services/api';
import {
    ACCOUNT_TELEMETRY_EVENTS,
    trackAccountEvent,
} from '@/services/accountTelemetry';
import { normalizePhone, trimText } from './profileUtils';

const INITIAL_ADDRESS_FORM = {
    type: 'home',
    name: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    isDefault: false,
};

export function useAddresses({ canUseProtectedProfileApis, showMsg, t, setProfile }) {
    const [showAddressForm, setShowAddressForm] = useState(false);
    const [editingAddress, setEditingAddress] = useState(null);
    const [addressSaving, setAddressSaving] = useState(false);
    const [addressSubmitError, setAddressSubmitError] = useState('');
    const [addressesLoading, setAddressesLoading] = useState(false);
    const [addressesError, setAddressesError] = useState('');
    const [addressForm, setAddressForm] = useState({ ...INITIAL_ADDRESS_FORM });

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
    }, [canUseProtectedProfileApis, setProfile, t]);

    const resetAddressForm = useCallback(() => {
        setAddressForm({ ...INITIAL_ADDRESS_FORM });
        setEditingAddress(null);
        setAddressSubmitError('');
        setShowAddressForm(false);
    }, []);

    const startEditAddress = useCallback((address) => {
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
    }, []);

    const handleSaveAddress = useCallback(async () => {
        setAddressSaving(true);
        setAddressSubmitError('');
        const addingAddress = !editingAddress;
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
            if (addingAddress) {
                trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.ADDRESS_ADDED, {
                    addressType: payload.type,
                });
            }
        } catch (error) {
            const errorMessage = error.message || t('profile.message.addressSaveFailed', {}, 'Failed to save address.');
            setAddressSubmitError(errorMessage);
            showMsg('error', errorMessage);
        } finally {
            setAddressSaving(false);
        }
    }, [addressForm, editingAddress, resetAddressForm, setProfile, showMsg, t]);

    const handleDeleteAddress = useCallback(async (id) => {
        try {
            const result = await userApi.deleteAddress(id);
            setProfile((previous) => ({ ...previous, addresses: result.addresses }));
            showMsg('success', t('profile.message.addressDeleted', {}, 'Address deleted.'));
            return true;
        } catch (error) {
            showMsg('error', error.message || t('profile.message.addressDeleteFailed', {}, 'Failed to delete address.'));
            return false;
        }
    }, [setProfile, showMsg, t]);

    const handleSetDefaultAddress = useCallback(async (address) => {
        if (!address?._id || address.isDefault || addressSaving) return;
        setAddressSaving(true);
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
            setAddressSaving(false);
        }
    }, [addressSaving, setProfile, showMsg, t]);

    return {
        showAddressForm,
        setShowAddressForm,
        editingAddress,
        addressForm,
        setAddressForm,
        addressSaving,
        addressSubmitError,
        addressesLoading,
        addressesError,
        addressActions: {
            refreshAddresses,
            resetAddressForm,
            startEditAddress,
            handleSaveAddress,
            handleDeleteAddress,
            handleSetDefaultAddress,
        },
    };
}
