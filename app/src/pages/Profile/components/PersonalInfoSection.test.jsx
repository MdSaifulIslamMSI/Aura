import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PersonalInfoSection from './PersonalInfoSection';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
        formatDateTime: (value) => new Date(value).toISOString().slice(0, 10),
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

const baseProps = {
    profile: {
        name: 'Profile User',
        email: 'profile@example.com',
        phone: '+919876543210',
        gender: 'prefer-not-to-say',
        dob: '1990-01-02T00:00:00.000Z',
        bio: 'Profile biography',
    },
    profileName: 'Profile User',
    profileEmail: 'profile@example.com',
    profilePhone: '+919876543210',
    editMode: true,
    setEditMode: vi.fn(),
    editForm: {
        name: 'Profile User',
        phone: '+919876543210',
        gender: 'prefer-not-to-say',
        dob: '1990-01-02',
        bio: 'Profile biography',
    },
    handleProfileFieldChange: vi.fn(),
    handleProfileFieldBlur: vi.fn(),
    onCancelEdit: vi.fn(),
    saving: false,
    handleSaveProfile: vi.fn((event) => event.preventDefault()),
    createEditForm: vi.fn(),
    profileDirty: true,
    profileFieldErrors: {},
    profileSubmitError: '',
    profileRequiresReauth: false,
    onReauthenticate: vi.fn(),
    memberSince: 'January 2025',
    hasOtpReadyIdentity: true,
    paymentMethodsSecured: true,
    trustHealthy: true,
    profileCompletion: 100,
    isAdminAccount: false,
    accountState: 'active',
};

describe('PersonalInfoSection', () => {
    it('exposes named fields, submits as a form, and reports field errors accessibly', () => {
        const handleProfileFieldChange = vi.fn();
        const handleSaveProfile = vi.fn((event) => event.preventDefault());
        render(<PersonalInfoSection
            {...baseProps}
            handleProfileFieldChange={handleProfileFieldChange}
            handleSaveProfile={handleSaveProfile}
            profileFieldErrors={{
                name: 'Enter a name between 2 and 50 characters.',
            }}
        />);

        const nameInput = screen.getByRole('textbox', { name: 'Full Name' });
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        expect(nameInput).toHaveAccessibleDescription('Enter a name between 2 and 50 characters.');

        fireEvent.change(nameInput, { target: { value: 'Updated User' } });
        expect(handleProfileFieldChange).toHaveBeenCalledWith('name', 'Updated User');

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(handleSaveProfile).toHaveBeenCalledTimes(1);
    });

    it('preserves the form and offers a reauthentication continuation after a recoverable denial', () => {
        const onReauthenticate = vi.fn();
        render(<PersonalInfoSection
            {...baseProps}
            profileSubmitError="Fresh phone verification is required."
            profileRequiresReauth
            onReauthenticate={onReauthenticate}
        />);

        expect(screen.getByRole('alert')).toHaveTextContent('Fresh phone verification is required.');
        fireEvent.click(screen.getByRole('button', { name: 'Verify identity and continue' }));
        expect(onReauthenticate).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveValue('+919876543210');
    });

    it('prevents submission when no profile field is dirty', () => {
        render(<PersonalInfoSection {...baseProps} profileDirty={false} />);

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('validates a field on blur and explains a disabled Save', () => {
        const handleProfileFieldBlur = vi.fn();
        render(<PersonalInfoSection
            {...baseProps}
            profileDirty={false}
            handleProfileFieldBlur={handleProfileFieldBlur}
        />);

        fireEvent.blur(screen.getByRole('textbox', { name: 'Phone Number' }));
        expect(handleProfileFieldBlur).toHaveBeenCalledWith('phone');
        expect(screen.getByRole('button', { name: 'Save' }))
            .toHaveAccessibleDescription('Make a change before saving');
    });

    it('cancels editing through the stable cancel handler', () => {
        const onCancelEdit = vi.fn();
        render(<PersonalInfoSection {...baseProps} onCancelEdit={onCancelEdit} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancelEdit).toHaveBeenCalledTimes(1);
    });
});
