import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapPin } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import AddressesSection from './AddressesSection';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

const savedAddress = {
    _id: '507f1f77bcf86cd799439011',
    type: 'home',
    name: 'Address User',
    phone: '919876543210',
    address: '12 Market Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    isDefault: true,
};

const baseProps = {
    profile: { addresses: [savedAddress] },
    ADDRESS_TYPES: [{ value: 'home', label: 'Home', icon: MapPin }],
    showAddressForm: false,
    setShowAddressForm: vi.fn(),
    editingAddress: null,
    addressForm: {
        type: 'home',
        name: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        isDefault: false,
    },
    setAddressForm: vi.fn(),
    saving: false,
    handleSaveAddress: vi.fn(),
    resetAddressForm: vi.fn(),
    startEditAddress: vi.fn(),
    handleDeleteAddress: vi.fn().mockResolvedValue(true),
    handleSetDefaultAddress: vi.fn(),
    addressSubmitError: '',
    addressesLoading: false,
    addressesError: '',
    onRetryAddresses: vi.fn(),
};

describe('AddressesSection', () => {
    it('uses labelled native form controls and reports server errors', () => {
        render(<AddressesSection
            {...baseProps}
            showAddressForm
            addressSubmitError="This address is already saved."
        />);

        expect(screen.getByRole('textbox', { name: 'Full Name' })).toBeRequired();
        expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveAttribute('autocomplete', 'tel');
        expect(screen.getByRole('textbox', { name: 'Address' })).toHaveAttribute('maxlength', '200');
        expect(screen.getByRole('alert')).toHaveTextContent('This address is already saved.');
    });

    it('explains order-history behavior before consequential deletion', async () => {
        const handleDeleteAddress = vi.fn().mockResolvedValue(true);
        render(<AddressesSection
            {...baseProps}
            handleDeleteAddress={handleDeleteAddress}
        />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(screen.getByRole('alertdialog')).toHaveTextContent(
            'Past orders keep their delivery copy.'
        );
        expect(screen.getByRole('button', { name: 'Keep address' })).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Delete address' }));
        await waitFor(() => {
            expect(handleDeleteAddress).toHaveBeenCalledWith(savedAddress._id);
        });
    });

    it('closes the delete dialog with Escape and restores trigger focus', async () => {
        render(<AddressesSection {...baseProps} />);

        const trigger = screen.getByRole('button', { name: 'Delete' });
        fireEvent.click(trigger);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
            expect(trigger).toHaveFocus();
        });
    });
});
