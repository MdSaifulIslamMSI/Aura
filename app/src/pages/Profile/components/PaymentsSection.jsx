import { CreditCard } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';

const formatPaymentType = (type, t) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return t('profile.payments.type.other', {}, 'Method');
    return t(`profile.payments.type.${normalized}`, {}, normalized.toUpperCase());
};

export default function PaymentsSection({
    paymentMethodsLoading, paymentMethods, handleSetDefaultMethod, handleDeletePaymentMethod,
}) {
    const { t } = useMarket();

    return (
        <div className="max-w-3xl">
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">{t('profile.payments.title', {}, 'Saved Payment Methods')}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('profile.payments.tokenizedOnly', {}, 'Tokenized methods only')}</span>
                </div>

                {paymentMethodsLoading ? (
                    <div className="py-6 text-sm text-gray-500">{t('profile.payments.loading', {}, 'Loading payment methods...')}</div>
                ) : paymentMethods.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-10 text-center">
                        <CreditCard className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                        <p className="font-semibold text-gray-700">{t('profile.payments.empty.title', {}, 'No saved payment methods yet')}</p>
                        <p className="mt-1 text-xs text-gray-400">{t('profile.payments.empty.body', {}, 'Complete a digital payment to auto-save tokenized methods.')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {paymentMethods.map((method) => (
                            <div key={method._id} className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-semibold text-gray-900">
                                        {formatPaymentType(method.type, t)}
                                        {method.brand ? ` | ${method.brand}` : ''}
                                        {method.last4 ? ` | **** ${method.last4}` : ''}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">{t('profile.payments.provider', { provider: method.provider || 'razorpay' }, `Provider: ${method.provider || 'razorpay'}`)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {method.isDefault ? (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                            {t('profile.payments.defaultBadge', {}, 'Default')}
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleSetDefaultMethod(method._id)}
                                            className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                                        >
                                            {t('profile.payments.setDefault', {}, 'Set Default')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleDeletePaymentMethod(method._id)}
                                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                                    >
                                        {t('profile.payments.remove', {}, 'Remove')}
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
