import { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle, CreditCard, Clock, Loader2, Plus, ReceiptText, ShieldCheck } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';

const formatPaymentType = (type, t) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return t('profile.payments.type.other', {}, 'Method');
    return t(`profile.payments.type.${normalized}`, {}, normalized.toUpperCase());
};

const DIGITAL_PAYMENT_METHODS = new Set(['UPI', 'CARD', 'WALLET', 'NETBANKING']);

const getMethodDetail = (method, t) => {
    const bankName = method?.metadata?.bankName || method?.metadata?.bankCode || '';
    if (String(method?.type || '').trim().toLowerCase() === 'bank' && bankName) {
        return t('profile.payments.bankDetail', { bank: bankName }, `Bank: ${bankName}`);
    }
    if (method?.providerMethodId) {
        return t('profile.payments.tokenDetail', {}, 'Tokenized after successful digital checkout');
    }
    return '';
};

const getOrderPaymentState = (order) => {
    const explicitState = String(order?.paymentState || '').trim().toLowerCase();
    if (explicitState) return explicitState;
    if (order?.isPaid) return 'paid';
    return 'pending';
};

const getPaymentStateTone = (state) => {
    if (['captured', 'paid', 'authorized', 'partially_refunded'].includes(state)) {
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    }
    if (['failed', 'expired', 'refunded'].includes(state)) {
        return 'border-red-200 bg-red-50 text-red-700';
    }
    return 'border-amber-200 bg-amber-50 text-amber-700';
};

const getPaymentStateIcon = (state) => {
    if (['captured', 'paid', 'authorized', 'partially_refunded'].includes(state)) return CheckCircle;
    if (['failed', 'expired', 'refunded'].includes(state)) return AlertTriangle;
    return Clock;
};

const formatPaymentState = (state, t) => {
    const normalized = String(state || '').trim().toLowerCase();
    if (!normalized) return t('profile.payments.activity.state.pending', {}, 'Pending');
    return t(`profile.payments.activity.state.${normalized}`, {}, normalized.replace(/_/g, ' '));
};

const getRefundStatus = (order) => {
    const refunds = Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [];
    const latestRefund = refunds.length ? refunds[refunds.length - 1] : null;
    if (latestRefund?.status) return latestRefund.status;
    if (order?.refundSummary?.fullyRefunded) return 'refunded';
    return '';
};

export default function PaymentsSection({
    paymentMethodsLoading,
    paymentMethods,
    recentOrders = [],
    netbankingCatalog = null,
    netbankingCatalogLoading = false,
    handleAddStripeCard,
    handleSaveNetbankingBank,
    refreshNetbankingCatalog,
    handleSetDefaultMethod,
    handleDeletePaymentMethod,
}) {
    const { t, formatDateTime, formatPrice } = useMarket();
    const [cardEnrollmentBusy, setCardEnrollmentBusy] = useState(false);
    const [bankEnrollmentBusy, setBankEnrollmentBusy] = useState(false);
    const [selectedBankCode, setSelectedBankCode] = useState('');
    const banks = useMemo(
        () => (Array.isArray(netbankingCatalog?.banks) ? netbankingCatalog.banks : []),
        [netbankingCatalog?.banks]
    );
    const selectedBank = banks.find((bank) => String(bank.code || '').trim().toUpperCase() === selectedBankCode) || null;
    const paymentActivity = (Array.isArray(recentOrders) ? recentOrders : [])
        .filter((order) => order?.paymentMethod || order?.paymentState || order?.paymentIntentId)
        .slice(0, 5);

    const onAddCard = async () => {
        if (!handleAddStripeCard) return;
        setCardEnrollmentBusy(true);
        try {
            await handleAddStripeCard();
        } finally {
            setCardEnrollmentBusy(false);
        }
    };

    const onSaveBank = async () => {
        if (!handleSaveNetbankingBank || !selectedBank) return;
        setBankEnrollmentBusy(true);
        try {
            await handleSaveNetbankingBank(selectedBank);
        } finally {
            setBankEnrollmentBusy(false);
        }
    };

    return (
        <div className="max-w-3xl space-y-5">
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">{t('profile.payments.title', {}, 'Saved Payment Methods')}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('profile.payments.tokenizedOnly', {}, 'Tokenized methods only')}</span>
                </div>

                <div className="mb-6 grid gap-3 lg:grid-cols-[0.9fr_1.4fr]">
                    <button
                        type="button"
                        onClick={onAddCard}
                        disabled={cardEnrollmentBusy}
                        className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60"
                    >
                        {cardEnrollmentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {cardEnrollmentBusy
                            ? t('profile.payments.addCard.saving', {}, 'Saving card...')
                            : t('profile.payments.addCard.cta', {}, 'Add Stripe card')}
                    </button>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label className="sr-only" htmlFor="netbanking-bank-select">{t('profile.payments.addBank.label', {}, 'NetBanking bank')}</label>
                        <select
                            id="netbanking-bank-select"
                            value={selectedBankCode}
                            onFocus={() => {
                                if (!netbankingCatalog && !netbankingCatalogLoading) {
                                    void refreshNetbankingCatalog?.();
                                }
                            }}
                            onChange={(event) => setSelectedBankCode(event.target.value)}
                            className="min-h-[52px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 outline-none focus:border-indigo-300"
                        >
                            <option value="">
                                {netbankingCatalogLoading
                                    ? t('profile.payments.addBank.loading', {}, 'Loading banks...')
                                    : t('profile.payments.addBank.placeholder', {}, 'Choose NetBanking bank')}
                            </option>
                            {banks.map((bank) => (
                                <option key={bank.code} value={bank.code}>
                                    {bank.name}{bank.isSaved ? ` (${t('profile.payments.addBank.saved', {}, 'saved')})` : ''}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={onSaveBank}
                            disabled={!selectedBank || bankEnrollmentBusy || netbankingCatalogLoading}
                            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
                        >
                            {bankEnrollmentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                            {bankEnrollmentBusy
                                ? t('profile.payments.addBank.saving', {}, 'Saving bank...')
                                : t('profile.payments.addBank.cta', {}, 'Save bank')}
                        </button>
                    </div>
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
                        {paymentMethods.map((method) => {
                            const methodDetail = getMethodDetail(method, t);
                            return (
                                <div key={method._id} className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="font-semibold text-gray-900">
                                            {formatPaymentType(method.type, t)}
                                            {method.brand ? ` | ${method.brand}` : ''}
                                            {method.last4 ? ` | **** ${method.last4}` : ''}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">{t('profile.payments.provider', { provider: method.provider || 'razorpay' }, `Provider: ${method.provider || 'razorpay'}`)}</p>
                                        {methodDetail ? (
                                            <p className="mt-1 text-xs text-gray-400">{methodDetail}</p>
                                        ) : null}
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
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">{t('profile.payments.activity.title', {}, 'Recent Payment Activity')}</h3>
                        <p className="mt-1 text-xs text-gray-500">{t('profile.payments.activity.body', {}, 'Recent order payment states, provider routing, and refund signals from your account.')}</p>
                    </div>
                    <ReceiptText className="h-5 w-5 text-indigo-500" />
                </div>

                {paymentActivity.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-8 text-center">
                        <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-gray-300" />
                        <p className="font-semibold text-gray-700">{t('profile.payments.activity.empty.title', {}, 'No payment activity yet')}</p>
                        <p className="mt-1 text-xs text-gray-400">{t('profile.payments.activity.empty.body', {}, 'Completed orders will show provider and payment state here.')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {paymentActivity.map((order) => {
                            const state = getOrderPaymentState(order);
                            const StateIcon = getPaymentStateIcon(state);
                            const method = String(order.paymentMethod || 'COD').trim().toUpperCase();
                            const isDigitalMethod = DIGITAL_PAYMENT_METHODS.has(method);
                            const provider = order.paymentProvider || (isDigitalMethod ? t('profile.payments.activity.providerRouted', {}, 'provider routed') : '');
                            const refundStatus = getRefundStatus(order);
                            const orderId = String(order._id || '').slice(-8).toUpperCase();
                            return (
                                <div key={order._id || order.createdAt} className="rounded-xl border p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                                                {t('profile.payments.activity.order', { id: orderId }, `Order #${orderId}`)}
                                            </p>
                                            <p className="mt-1 font-semibold text-gray-900">
                                                {method}
                                                {provider ? ` | ${provider}` : ''}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {formatDateTime(order.createdAt)}
                                                {order.paymentIntentId ? ` | ${order.paymentIntentId}` : ''}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getPaymentStateTone(state)}`}>
                                                <StateIcon className="h-3 w-3" />
                                                {formatPaymentState(state, t)}
                                            </span>
                                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                                                {formatPrice(order.presentmentTotalPrice || order.totalPrice || 0, order.presentmentCurrency || order.currency || 'INR')}
                                            </span>
                                        </div>
                                    </div>
                                    {refundStatus ? (
                                        <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
                                            {t('profile.payments.activity.refundStatus', { status: refundStatus }, `Refund status: ${refundStatus}`)}
                                        </p>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
