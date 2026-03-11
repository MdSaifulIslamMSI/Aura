import { CheckCircle2, Loader2, MapPin, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import PremiumSelect from '@/components/ui/premium-select';

const ADDRESS_TYPES = ['home', 'work', 'other'];

const StepAddress = ({
    isActive,
    completed,
    contact,
    shippingAddress,
    savedAddresses,
    selectedAddressId,
    addressType,
    isSavingAddress,
    isDetectingGps,
    gpsHint,
    addressError,
    onSetActive,
    onContactChange,
    onAddressChange,
    onAddressTypeChange,
    onSelectSavedAddress,
    onSaveNewAddress,
    onUpdateSelectedAddress,
    onDetectGps,
    onContinue,
}) => {
    return (
        <section
            className={cn(
                'checkout-premium-card transition-all duration-300',
                isActive && 'checkout-premium-card-active'
            )}
        >
            <button
                type="button"
                onClick={onSetActive}
                className="checkout-premium-header w-full"
            >
                <h3 className={cn('flex items-center gap-3 text-sm font-black uppercase tracking-[0.22em] md:text-base', isActive ? 'text-neo-cyan' : 'text-white')}>
                    <Truck className="w-5 h-5" />
                    1. Delivery Address
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="p-6 md:p-8 space-y-6">
                    {savedAddresses.length > 0 ? (
                        <div>
                            <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-slate-400">Saved Addresses</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {savedAddresses.map((addr) => (
                                    <button
                                        key={addr._id}
                                        type="button"
                                        onClick={() => onSelectSavedAddress(addr._id)}
                                        className={cn(
                                            'checkout-premium-option',
                                            selectedAddressId === addr._id && 'checkout-premium-option-active'
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] uppercase tracking-[0.22em] font-black text-neo-cyan">{addr.type}</span>
                                            {addr.isDefault ? <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.2em]">default</span> : null}
                                        </div>
                                        <p className="text-white font-semibold text-sm">{addr.name}</p>
                                        <p className="mt-1 text-slate-400 text-xs leading-6">{addr.address}</p>
                                        <p className="text-slate-500 text-xs">{addr.city}, {addr.state} - {addr.pincode}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">Contact Name</span>
                            <input
                                value={contact.name}
                                onChange={(event) => onContactChange('name', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="Full Name"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">Phone Number</span>
                            <input
                                value={contact.phone}
                                onChange={(event) => onContactChange('phone', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="+91 98XXXXXXXX"
                            />
                        </label>
                        <label className="space-y-2 md:col-span-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">Street Address</span>
                            <input
                                value={shippingAddress.address}
                                onChange={(event) => onAddressChange('address', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="Apartment, area, street"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">City</span>
                            <input
                                value={shippingAddress.city}
                                onChange={(event) => onAddressChange('city', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="City"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">Postal Code</span>
                            <input
                                value={shippingAddress.postalCode}
                                onChange={(event) => onAddressChange('postalCode', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="Pincode"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">State / Country</span>
                            <input
                                value={shippingAddress.country}
                                onChange={(event) => onAddressChange('country', event.target.value)}
                                className="checkout-premium-input"
                                placeholder="State"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-[0.22em] font-black text-slate-400">Address Type</span>
                            <PremiumSelect
                                value={addressType}
                                onChange={(event) => onAddressTypeChange(event.target.value)}
                                className="checkout-premium-input"
                            >
                                {ADDRESS_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </PremiumSelect>
                        </label>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <button
                            type="button"
                            onClick={onDetectGps}
                            disabled={isDetectingGps}
                            className="checkout-premium-secondary w-full sm:w-auto text-xs font-black uppercase tracking-[0.2em] text-neo-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isDetectingGps ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                            {isDetectingGps ? 'Detecting GPS...' : 'Autofill from GPS'}
                        </button>
                        {gpsHint ? <p className="text-xs text-emerald-300 font-semibold">{gpsHint}</p> : null}
                    </div>

                    {addressError ? (
                        <div className="checkout-premium-alert border-rose-500/30 bg-rose-500/10 text-rose-200">
                            {addressError}
                        </div>
                    ) : null}

                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onSaveNewAddress}
                            disabled={isSavingAddress}
                            className="checkout-premium-secondary w-full sm:w-auto text-xs font-black uppercase tracking-[0.2em] disabled:opacity-50"
                        >
                            {isSavingAddress ? 'Saving...' : 'Save As New Address'}
                        </button>
                        {selectedAddressId ? (
                            <button
                                type="button"
                                onClick={onUpdateSelectedAddress}
                                disabled={isSavingAddress}
                                className="checkout-premium-secondary w-full sm:w-auto text-xs font-black uppercase tracking-[0.2em] disabled:opacity-50"
                            >
                                {isSavingAddress ? 'Updating...' : 'Update Selected Address'}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={onContinue}
                            className="checkout-premium-primary w-full sm:w-auto sm:ml-auto px-8 py-3 text-sm uppercase tracking-[0.24em] font-black"
                        >
                            Continue
                        </button>
                    </div>

                    <div className="checkout-premium-note text-xs">
                        <MapPin className="w-4 h-4" />
                        Address details are saved securely to your profile for faster checkout.
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepAddress;
