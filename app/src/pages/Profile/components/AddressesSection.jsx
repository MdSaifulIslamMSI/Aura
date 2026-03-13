import { MapPin, Plus, Save, Phone, Edit3, Trash2 } from 'lucide-react';

export default function AddressesSection({ 
    profile, ADDRESS_TYPES, showAddressForm, setShowAddressForm, editingAddress, 
    addressForm, setAddressForm, saving, handleSaveAddress, resetAddressForm, 
    startEditAddress, handleDeleteAddress 
}) {
    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-lg font-bold text-gray-900">Saved Addresses</h3>
                <button onClick={() => { resetAddressForm(); setShowAddressForm(true); }}
                    className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 transition-colors">
                    <Plus className="w-4 h-4" /> Add Address
                </button>
            </div>

            {/* Address Form Modal */}
            {showAddressForm && (
                <div className="bg-white rounded-2xl border shadow-sm p-6">
                    <h4 className="font-bold text-gray-900 mb-4">{editingAddress ? 'Edit Address' : 'New Address'}</h4>

                    {/* Type selector */}
                    <div className="flex gap-3 mb-4">
                        {ADDRESS_TYPES.map(t => {
                            const Icon = t.icon;
                            return (
                                <button key={t.value} onClick={() => setAddressForm(p => ({ ...p, type: t.value }))}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
              ${addressForm.type === t.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
                                    <Icon className="w-4 h-4" /> {t.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input value={addressForm.name} onChange={e => setAddressForm(p => ({ ...p, name: e.target.value }))}
                            placeholder="Full Name *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        <input value={addressForm.phone} onChange={e => setAddressForm(p => ({ ...p, phone: e.target.value }))}
                            placeholder="Phone Number *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        <textarea value={addressForm.address} onChange={e => setAddressForm(p => ({ ...p, address: e.target.value }))}
                            placeholder="Full Address *" rows={2}
                            className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none resize-none sm:col-span-2" />
                        <input value={addressForm.city} onChange={e => setAddressForm(p => ({ ...p, city: e.target.value }))}
                            placeholder="City *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        <input value={addressForm.state} onChange={e => setAddressForm(p => ({ ...p, state: e.target.value }))}
                            placeholder="State *" className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        <input value={addressForm.pincode} onChange={e => setAddressForm(p => ({ ...p, pincode: e.target.value }))}
                            placeholder="Pincode *" maxLength={6} className="p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border-2 border-gray-200 cursor-pointer">
                            <input type="checkbox" checked={addressForm.isDefault}
                                onChange={e => setAddressForm(p => ({ ...p, isDefault: e.target.checked }))}
                                className="w-5 h-5 text-indigo-600 rounded" />
                            <span className="font-semibold text-gray-700 text-sm">Set as default</span>
                        </label>
                    </div>

                    <div className="flex gap-3 mt-5">
                        <button onClick={handleSaveAddress} disabled={saving || !addressForm.name || !addressForm.phone || !addressForm.address || !addressForm.city || !addressForm.state || !addressForm.pincode}
                            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                            {editingAddress ? 'Update' : 'Save'} Address
                        </button>
                        <button onClick={resetAddressForm}
                            className="px-5 py-2.5 border rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Address Cards */}
            {(!profile?.addresses || profile.addresses.length === 0) && !showAddressForm ? (
                <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
                    <MapPin className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-gray-900 mb-1">No addresses saved</h3>
                    <p className="text-gray-400 text-sm">Add your delivery address for faster checkout</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {profile?.addresses?.map(addr => {
                        const TypeIcon = ADDRESS_TYPES.find(t => t.value === addr.type)?.icon || MapPin;
                        return (
                            <div key={addr._id} className={`bg-white rounded-2xl border shadow-sm p-5 relative ${addr.isDefault ? 'ring-2 ring-indigo-500' : ''}`}>
                                {addr.isDefault && (
                                    <span className="absolute top-3 right-3 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full">DEFAULT</span>
                                )}
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                                        <TypeIcon className="w-4 h-4 text-indigo-600" />
                                    </div>
                                    <span className="font-bold text-gray-900 capitalize">{addr.type}</span>
                                </div>
                                <p className="font-semibold text-gray-900">{addr.name}</p>
                                <p className="text-sm text-gray-600 mt-1">{addr.address}</p>
                                <p className="text-sm text-gray-600">{addr.city}, {addr.state} — {addr.pincode}</p>
                                <p className="text-sm text-gray-500 mt-1 flex items-center gap-1"><Phone className="w-3 h-3" /> {addr.phone}</p>
                                <div className="flex gap-2 mt-3 pt-3 border-t">
                                    <button onClick={() => startEditAddress(addr)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                                        <Edit3 className="w-3 h-3" /> Edit
                                    </button>
                                    <button onClick={() => handleDeleteAddress(addr._id)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                                        <Trash2 className="w-3 h-3" /> Delete
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
