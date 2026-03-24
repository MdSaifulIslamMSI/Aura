import { CreditCard } from 'lucide-react';

const PAYMENT_TYPE_LABELS = {
    upi: 'UPI',
    card: 'Card',
    wallet: 'Wallet',
    bank: 'NetBanking',
    other: 'Method',
};

const formatPaymentType = (type) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return 'Method';
    return PAYMENT_TYPE_LABELS[normalized] || normalized.toUpperCase();
};

export default function PaymentsSection({ 
    paymentMethodsLoading, paymentMethods, handleSetDefaultMethod, handleDeletePaymentMethod 
}) {
    return (
        <div className="max-w-3xl">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">Saved Payment Methods</h3>
                    <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Tokenized methods only</span>
                </div>

                {paymentMethodsLoading ? (
                    <div className="text-sm text-gray-500 py-6">Loading payment methods...</div>
                ) : paymentMethods.length === 0 ? (
                    <div className="text-center py-10 border border-dashed rounded-xl">
                        <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                        <p className="font-semibold text-gray-700">No saved payment methods yet</p>
                        <p className="text-xs text-gray-400 mt-1">Complete a digital payment to auto-save tokenized methods.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {paymentMethods.map((method) => (
                            <div key={method._id} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div>
                                    <p className="font-semibold text-gray-900">
                                        {formatPaymentType(method.type)}
                                        {method.brand ? ` | ${method.brand}` : ''}
                                        {method.last4 ? ` | **** ${method.last4}` : ''}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">Provider: {method.provider || 'razorpay'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {method.isDefault ? (
                                        <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold">
                                            Default
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleSetDefaultMethod(method._id)}
                                            className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                                        >
                                            Set Default
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleDeletePaymentMethod(method._id)}
                                        className="px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
