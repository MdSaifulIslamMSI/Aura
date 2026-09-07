import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: stableFns.t }),
}));

vi.mock('@/components/ui/premium-select', () => ({
  default: ({ value, onChange, children }) => (
    <select data-testid="address-type" value={value} onChange={onChange}>
      {children}
    </select>
  ),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => stableFns.t,
}));

import StepAddress from './StepAddress';

const baseProps = (overrides = {}) => ({
  isActive: true,
  completed: false,
  contact: { name: '', phone: '' },
  shippingAddress: { address: '', city: '', postalCode: '', country: '' },
  savedAddresses: [],
  selectedAddressId: null,
  addressType: 'home',
  isSavingAddress: false,
  isDetectingGps: false,
  gpsHint: '',
  addressSchema: {},
  addressError: '',
  onSetActive: vi.fn(),
  onContactChange: vi.fn(),
  onAddressChange: vi.fn(),
  onAddressTypeChange: vi.fn(),
  onSelectSavedAddress: vi.fn(),
  onSaveNewAddress: vi.fn(),
  onUpdateSelectedAddress: vi.fn(),
  onDetectGps: vi.fn(),
  onContinue: vi.fn(),
  ...overrides,
});

describe('StepAddress', () => {
  it('renders collapsed without the form', () => {
    render(<StepAddress {...baseProps({ isActive: false })} />);
    expect(screen.getByText('1. Delivery Address')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Full Name')).toBeNull();
  });

  it('shows the completed check when done', () => {
    const { container } = render(<StepAddress {...baseProps({ completed: true })} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('edits contact and address fields through callbacks', () => {
    const props = baseProps();
    render(<StepAddress {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Asha' } });
    expect(props.onContactChange).toHaveBeenCalledWith('name', 'Asha');
    fireEvent.change(screen.getByPlaceholderText('Apartment, area, street'), { target: { value: '221B' } });
    expect(props.onAddressChange).toHaveBeenCalledWith('address', '221B');
  });

  it('selects saved addresses and marks the active one', () => {
    const props = baseProps({
      savedAddresses: [
        { _id: 'a-1', type: 'home', name: 'Asha', address: 'Street 1', city: 'Pune', state: 'MH', pincode: '411001', isDefault: true },
        { _id: 'a-2', type: 'work', name: 'Asha', address: 'Street 2', city: 'Mumbai', state: 'MH', pincode: '400001' },
      ],
      selectedAddressId: 'a-1',
    });
    const { container } = render(<StepAddress {...props} />);
    expect(screen.getByText('Saved Addresses')).toBeInTheDocument();
    expect(container.querySelectorAll('.checkout-premium-option-active')).toHaveLength(1);
    fireEvent.click(screen.getByText('Street 2'));
    expect(props.onSelectSavedAddress).toHaveBeenCalledWith('a-2');
  });

  it('uses schema labels for locale-specific fields', () => {
    render(<StepAddress {...baseProps({
      addressSchema: { administrativeAreaLabel: 'State', postalCodeLabel: 'PIN Code', postalCodeExample: '6-digit PIN', phoneCode: '+1' },
    })} />);
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6-digit PIN')).toBeInTheDocument();
  });

  it('runs GPS detection and continues the flow', () => {
    const props = baseProps({ gpsHint: 'Locked to Pune' });
    render(<StepAddress {...props} />);
    expect(screen.getByText('Locked to Pune')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Autofill from GPS' }));
    expect(props.onDetectGps).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onContinue).toHaveBeenCalledOnce();
  });

  it('surfaces address errors and saving state', () => {
    render(<StepAddress {...baseProps({ addressError: 'PIN code invalid', isSavingAddress: true })} />);
    expect(screen.getByText('PIN code invalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('changes the address type through the select', () => {
    const props = baseProps();
    render(<StepAddress {...props} />);
    fireEvent.change(screen.getByTestId('address-type'), { target: { value: 'work' } });
    expect(props.onAddressTypeChange).toHaveBeenCalledWith('work');
  });
});
