import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle, CreditCard, Clock, Loader2, Plus, ReceiptText, ShieldCheck } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { EmptyState, SectionSkeleton } from './ProfileShared';

const formatPaymentType = (type, t) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return t('profile.payments.type.other', {}, 'Method');
    switch (normalized) {
        case 'bank':
            return t('profile.payments.type.bank', {}, 'BANK');
        case 'card':
            return t('profile.payments.type.card', {}, 'CARD');
        case 'upi':
            return t('profile.payments.type.upi', {}, 'UPI');
        case 'wallet':
            return t('profile.payments.type.wallet', {}, 'WALLET');
        default:
            return normalized.toUpperCase();
    }
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
        return 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200';
    }
    if (['failed', 'expired', 'refunded'].includes(state)) {
        return 'border-rose-400/20 bg-rose-500/12 text-rose-200';
    }
    return 'border-amber-400/20 bg-amber-500/12 text-amber-200';
};

const getPaymentStateIcon = (state) => {
    if (['captured', 'paid', 'authorized', 'partially_refunded'].includes(state)) return CheckCircle;
    if (['failed', 'expired', 'refunded'].includes(state)) return AlertTriangle;
    return Clock;
};

const formatPaymentState = (state, t) => {
    const normalized = String(state || '').trim().toLowerCase();
    if (!normalized) return t('profile.payments.activity.state.pending', {}, 'Pending');
    switch (normalized) {
        case 'captured':
            return t('profile.payments.activity.state.captured', {}, 'captured');
        case 'paid':
            return t('profile.payments.activity.state.paid', {}, 'paid');
        case 'authorized':
            return t('profile.payments.activity.state.authorized', {}, 'authorized');
        case 'partially_refunded':
        case 'partiallyrefunded':
            return t('profile.payments.activity.state.partiallyRefunded', {}, 'partially refunded');
        case 'failed':
            return t('profile.payments.activity.state.failed', {}, 'failed');
        case 'expired':
            return t('profile.payments.activity.state.expired', {}, 'expired');
        case 'refunded':
            return t('profile.payments.activity.state.refunded', {}, 'refunded');
        default:
            return normalized.replace(/_/g, ' ');
    }
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
    const { t: legacyT, formatDateTime, formatPrice } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const intl = useIntl();
    const [cardEnrollmentBusy, setCardEnrollmentBusy] = useState(false);
    const [bankEnrollmentBusy, setBankEnrollmentBusy] = useState(false);
    const [selectedBankCode, setSelectedBankCode] = useState('');
    const [pendingDeleteId, setPendingDeleteId] = useState('');
    const pendingDeleteTimer = useRef(null);

    useEffect(() => () => {
        if (pendingDeleteTimer.current) window.clearTimeout(pendingDeleteTimer.current);
    }, []);

    const onRemoveMethod = (methodId) => {
        if (pendingDeleteId !== methodId) {
            setPendingDeleteId(methodId);
            if (pendingDeleteTimer.current) window.clearTimeout(pendingDeleteTimer.current);
            pendingDeleteTimer.current = window.setTimeout(() => setPendingDeleteId(''), 5000);
            return;
        }
        if (pendingDeleteTimer.current) window.clearTimeout(pendingDeleteTimer.current);
        setPendingDeleteId('');
        void handleDeletePaymentMethod(methodId);
    };
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
        <div className="space-y-5">
            <div className="premium-panel premium-card-hover p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-xl font-black text-white">{t('profile.payments.title', {}, 'Saved Payment Methods')}</h2>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t('profile.payments.tokenizedOnly', {}, 'Tokenized methods only')}</span>
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
                                    {bank.name}{bank.isSaved ? ' ' + intl.formatMessage(
                                        { id: 'profile.payments.addBank.saved.option', defaultMessage: '({label})' },
                                        { label: t('profile.payments.addBank.saved', {}, 'saved') },
                                    ) : ''}
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
                    <SectionSkeleton rows={2} label={t('profile.payments.loading', {}, 'Loading payment methods...')} />
                ) : paymentMethods.length === 0 ? (
                    <EmptyState
                        icon={CreditCard}
                        title={t('profile.payments.empty.title', {}, 'No saved payment methods yet')}
                        body={t('profile.payments.empty.body', {}, 'Complete a digital payment to auto-save tokenized methods.')}
                    />
                ) : (
                    <div className="space-y-3">
                        {paymentMethods.map((method) => {
                            const methodDetail = getMethodDetail(method, t);
                            return (
                                <div key={method._id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="font-semibold text-white">
                                            {formatPaymentType(method.type, t)}
                                            {method.brand ? ' ' + intl.formatMessage(
                                                { id: 'profile.payments.method.brandSuffix', defaultMessage: '| {brand}' },
                                                { brand: method.brand },
                                            ) : ''}
                                            {method.last4 ? ' ' + intl.formatMessage(
                                                { id: 'profile.payments.method.last4Suffix', defaultMessage: '| **** {last4}' },
                                                { last4: method.last4 },
                                            ) : ''}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-400">{t('profile.payments.provider', { provider: method.provider || 'razorpay' }, `Provider: ${method.provider || 'razorpay'}`)}</p>
                                        {methodDetail ? (
                                            <p className="mt-1 text-xs text-slate-400">{methodDetail}</p>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {method.isDefault ? (
                                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/12 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                                                {t('profile.payments.defaultBadge', {}, 'Default')}
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleSetDefaultMethod(method._id)}
                                                className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
                                            >
                                                {t('profile.payments.setDefault', {}, 'Set Default')}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => onRemoveMethod(method._id)}
                                            aria-live="polite"
                                            className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${pendingDeleteId === method._id
                                                ? 'border-rose-300/40 bg-rose-500/25 text-white'
                                                : 'border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'}`}
                                        >
                                            {pendingDeleteId === method._id
                                                ? t('profile.payments.confirmRemove', {}, 'Click again to confirm')
                                                : t('profile.payments.remove', {}, 'Remove')}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="premium-panel premium-card-hover p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-black text-white">{t('profile.payments.activity.title', {}, 'Recent Payment Activity')}</h2>
                        <p className="mt-1 text-xs text-slate-400">{t('profile.payments.activity.body', {}, 'Recent order payment states, provider routing, and refund signals from your account.')}</p>
                    </div>
                    <ReceiptText className="h-5 w-5 text-[#d2a96c]" aria-hidden="true" />
                </div>

                {paymentActivity.length === 0 ? (
                    <EmptyState
                        icon={ShieldCheck}
                        title={t('profile.payments.activity.empty.title', {}, 'No payment activity yet')}
                        body={t('profile.payments.activity.empty.body', {}, 'Completed orders will show provider and payment state here.')}
                    />
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
                                <div key={order._id || order.createdAt} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                                {t('profile.payments.activity.order', { id: orderId }, `Order #${orderId}`)}
                                            </p>
                                            <p className="mt-1 font-semibold text-white">
                                                {method}
                                                {provider ? ' ' + intl.formatMessage(
                                                    { id: 'profile.payments.activity.providerSuffix', defaultMessage: '| {provider}' },
                                                    { provider },
                                                ) : ''}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400">
                                                {formatDateTime(order.createdAt)}
                                                {order.paymentIntentId ? ' ' + intl.formatMessage(
                                                    { id: 'profile.payments.activity.paymentIntentSuffix', defaultMessage: '| {paymentIntentId}' },
                                                    { paymentIntentId: order.paymentIntentId },
                                                ) : ''}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getPaymentStateTone(state)}`}>
                                                <StateIcon className="h-3 w-3" aria-hidden="true" />
                                                {formatPaymentState(state, t)}
                                            </span>
                                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-200">
                                                {formatPrice(order.presentmentTotalPrice || order.totalPrice || 0, order.presentmentCurrency || order.currency || 'INR')}
                                            </span>
                                        </div>
                                    </div>
                                    {refundStatus ? (
                                        <p className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200">
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
