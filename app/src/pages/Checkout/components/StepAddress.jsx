import { CheckCircle2, Loader2, MapPin, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

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
                'bg-white/5 backdrop-blur-xl rounded-3xl border shadow-glass overflow-hidden transition-all duration-300',
                isActive ? 'border-neo-cyan/50 shadow-[0_0_30px_rgba(6,182,212,0.12)]' : 'border-white/10'
            )}
        >
            <button
                type="button"
                onClick={onSetActive}
                className="w-full p-6 bg-zinc-950/50 border-b border-white/5 flex items-center justify-between text-left"
            >
                <h3 className={cn('font-black uppercase tracking-widest text-sm md:text-base flex items-center gap-3', isActive ? 'text-neo-cyan' : 'text-white')}>
                    <Truck className="w-5 h-5" />
                    1. Delivery Address
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="p-6 md:p-8 space-y-6">
                    {savedAddresses.length > 0 ? (
                        <div>
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-3">Saved Addresses</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {savedAddresses.map((addr) => (
                                    <button
                                        key={addr._id}
                                        type="button"
                                        onClick={() => onSelectSavedAddress(addr._id)}
                                        className={cn(
                                            'p-4 rounded-xl border text-left transition-all',
                                            selectedAddressId === addr._id
                                                ? 'border-neo-cyan bg-neo-cyan/10'
                                                : 'border-white/10 hover:border-white/30 bg-zinc-950/40'
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] uppercase tracking-widest font-black text-neo-cyan">{addr.type}</span>
                                            {addr.isDefault ? <span className="text-[10px] uppercase text-slate-300">default</span> : null}
                                        </div>
                                        <p className="text-white font-semibold text-sm">{addr.name}</p>
                                        <p className="text-slate-400 text-xs">{addr.address}</p>
                                        <p className="text-slate-500 text-xs">{addr.city}, {addr.state} - {addr.pincode}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Contact Name</span>
                            <input
                                value={contact.name}
                                onChange={(event) => onContactChange('name', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="Full Name"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Phone Number</span>
                            <input
                                value={contact.phone}
                                onChange={(event) => onContactChange('phone', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="+91 98XXXXXXXX"
                            />
                        </label>
                        <label className="space-y-2 md:col-span-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Street Address</span>
                            <input
                                value={shippingAddress.address}
                                onChange={(event) => onAddressChange('address', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="Apartment, area, street"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">City</span>
                            <input
                                value={shippingAddress.city}
                                onChange={(event) => onAddressChange('city', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="City"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Postal Code</span>
                            <input
                                value={shippingAddress.postalCode}
                                onChange={(event) => onAddressChange('postalCode', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="Pincode"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">State / Country</span>
                            <input
                                value={shippingAddress.country}
                                onChange={(event) => onAddressChange('country', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                                placeholder="State"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Address Type</span>
                            <select
                                value={addressType}
                                onChange={(event) => onAddressTypeChange(event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                            >
                                {ADDRESS_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <button
                            type="button"
                            onClick={onDetectGps}
                            disabled={isDetectingGps}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-neo-cyan/40 bg-neo-cyan/10 text-sm font-bold uppercase tracking-wider text-neo-cyan hover:bg-neo-cyan/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isDetectingGps ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                            {isDetectingGps ? 'Detecting GPS...' : 'Autofill from GPS'}
                        </button>
                        {gpsHint ? <p className="text-xs text-emerald-300 font-semibold">{gpsHint}</p> : null}
                    </div>

                    {addressError ? (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-200 text-sm">
                            {addressError}
                        </div>
                    ) : null}

                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onSaveNewAddress}
                            disabled={isSavingAddress}
                            className="w-full sm:w-auto px-4 py-2 rounded-xl border border-white/15 text-sm font-bold uppercase tracking-wider text-slate-200 hover:border-neo-cyan/40 transition-colors disabled:opacity-50"
                        >
                            {isSavingAddress ? 'Saving...' : 'Save As New Address'}
                        </button>
                        {selectedAddressId ? (
                            <button
                                type="button"
                                onClick={onUpdateSelectedAddress}
                                disabled={isSavingAddress}
                                className="w-full sm:w-auto px-4 py-2 rounded-xl border border-white/15 text-sm font-bold uppercase tracking-wider text-slate-200 hover:border-neo-cyan/40 transition-colors disabled:opacity-50"
                            >
                                {isSavingAddress ? 'Updating...' : 'Update Selected Address'}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={onContinue}
                            className="w-full sm:w-auto sm:ml-auto btn-primary px-8 py-3 text-sm uppercase tracking-widest font-black shadow-[0_0_20px_rgba(6,182,212,0.25)]"
                        >
                            Continue
                        </button>
                    </div>

                    <div className="text-xs text-slate-500 flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        Address details are saved securely to your profile for faster checkout.
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepAddress;
