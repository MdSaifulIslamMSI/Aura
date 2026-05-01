import { useMemo, useState } from 'react';
import {
    AlertCircle,
    Building2,
    CheckCircle2,
    CreditCard,
    KeyRound,
    Loader2,
    LockKeyhole,
    RadioTower,
    RefreshCw,
    RotateCcw,
    Search,
    Server,
    ShieldCheck,
    Smartphone,
    Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import { useMarket } from '@/context/MarketContext';

const PAYMENT_OPTIONS = [
    { id: 'COD', titleKey: 'checkout.payment.codTitle', titleFallback: 'Cash on Delivery', descriptionKey: 'checkout.payment.codDescription', descriptionFallback: 'Pay when your order arrives', icon: Wallet },
    { id: 'UPI', titleKey: 'checkout.payment.upiTitle', titleFallback: 'UPI', descriptionKey: 'checkout.payment.upiDescription', descriptionFallback: 'Fast payment via UPI apps', icon: Smartphone },
    { id: 'CARD', titleKey: 'checkout.payment.cardTitle', titleFallback: 'Card', descriptionKey: 'checkout.payment.cardDescription', descriptionFallback: 'Debit / credit card checkout', icon: CreditCard },
    { id: 'WALLET', titleKey: 'checkout.payment.walletTitle', titleFallback: 'Wallet', descriptionKey: 'checkout.payment.walletDescription', descriptionFallback: 'Wallet balance or linked wallet', icon: Wallet },
    { id: 'NETBANKING', titleKey: 'checkout.payment.netbankingTitle', titleFallback: 'NetBanking', descriptionKey: 'checkout.payment.netbankingDescription', descriptionFallback: 'Authorize directly from your bank portal', icon: Building2 },
];

const PAYMENT_BADGES = {
    COD: ['Cash', 'Verified', 'Doorstep'],
    UPI: ['BHIM', 'GPay', 'PhonePe', 'Paytm'],
    CARD: ['VISA', 'MC', 'AMEX', 'RuPay'],
    WALLET: ['Wallet', 'Balance', 'Linked'],
    NETBANKING: ['IMPS', 'NEFT', 'Bank'],
};

const MARKET_COUNTRY_PRESETS = [
    { code: 'IN', label: 'India' },
    { code: 'US', label: 'United States' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'DE', label: 'Germany' },
    { code: 'AU', label: 'Australia' },
    { code: 'CA', label: 'Canada' },
    { code: 'JP', label: 'Japan' },
];

const STATUS_STYLES = {
    created: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
    challenge_pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    authorized: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    captured: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    failed: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    expired: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
};

const getPaymentStatusMessage = (paymentIntent = {}, t) => {
    const status = String(paymentIntent.status || '').trim().toLowerCase();
    if (status === 'challenge_pending') return t('checkout.payment.status.challenge_pending', {}, 'Additional verification is required before payment authorization can continue.');
    if (status === 'created') return t('checkout.payment.status.created', {}, 'Payment authorization is ready. Complete the secure checkout window to continue.');
    if (status === 'authorized') return t('checkout.payment.status.authorized', {}, 'Payment has been authorized and is ready for order placement.');
    if (status === 'captured') return t('checkout.payment.status.captured', {}, 'Payment has already been captured by the provider.');
    if (status === 'failed') return t('checkout.payment.status.failed', {}, 'The provider rejected the payment authorization.');
    if (status === 'expired') return t('checkout.payment.status.expired', {}, 'This payment authorization expired. Start it again to continue.');
    return '';
};

const RAIL_SUMMARY = {
    UPI: {
        titleKey: 'checkout.payment.rail.upiTitle',
        titleFallback: 'UPI Live Rail',
        emptyKey: 'checkout.payment.rail.upiEmpty',
        emptyFallback: 'UPI capability data is loading from the provider.',
        format: (capability = {}, t) => {
            const apps = (capability.apps || []).slice(0, 4).map((entry) => entry.name).filter(Boolean);
            const flows = (capability.flows || []).join(', ');
            if (!capability.available) return t('checkout.payment.rail.upiUnavailable', {}, 'UPI is currently unavailable from the provider directory.');
            return t('checkout.payment.rail.upiFormat', {
                count: capability.appCount || apps.length || 0,
                apps: apps.length ? `: ${apps.join(', ')}` : '',
                flows: flows ? ` | ${t('checkout.payment.flows', {}, 'flows')}: ${flows}` : '',
            }, `${capability.appCount || apps.length || 0} apps live${apps.length ? `: ${apps.join(', ')}` : ''}${flows ? ` | flows: ${flows}` : ''}`);
        },
    },
    CARD: {
        titleKey: 'checkout.payment.rail.cardTitle',
        titleFallback: 'Card Rail Matrix',
        emptyKey: 'checkout.payment.rail.cardEmpty',
        emptyFallback: 'Card network capability data is loading from the provider.',
        format: (capability = {}, t) => {
            const networks = (capability.networks || []).slice(0, 4).map((entry) => entry.name).filter(Boolean);
            if (!capability.available) return t('checkout.payment.rail.cardUnavailable', {}, 'Card checkout is currently unavailable from the provider directory.');
            return t('checkout.payment.rail.cardFormat', {
                count: capability.networkCount || networks.length || 0,
                networks: networks.length ? `: ${networks.join(', ')}` : '',
                issuers: capability.issuerCount ? ` | ${capability.issuerCount} ${t('checkout.payment.issuersMapped', {}, 'issuers mapped')}` : '',
            }, `${capability.networkCount || networks.length || 0} card networks live${networks.length ? `: ${networks.join(', ')}` : ''}${capability.issuerCount ? ` | ${capability.issuerCount} issuers mapped` : ''}`);
        },
    },
    WALLET: {
        titleKey: 'checkout.payment.rail.walletTitle',
        titleFallback: 'Wallet Rail Matrix',
        emptyKey: 'checkout.payment.rail.walletEmpty',
        emptyFallback: 'Wallet capability data is loading from the provider.',
        format: (capability = {}, t) => {
            const wallets = (capability.wallets || []).slice(0, 4).map((entry) => entry.name).filter(Boolean);
            if (!capability.available) return t('checkout.payment.rail.walletUnavailable', {}, 'Wallet checkout is currently unavailable from the provider directory.');
            return t('checkout.payment.rail.walletFormat', {
                count: capability.walletCount || wallets.length || 0,
                wallets: wallets.length ? `: ${wallets.join(', ')}` : '',
            }, `${capability.walletCount || wallets.length || 0} wallets live${wallets.length ? `: ${wallets.join(', ')}` : ''}`);
        },
    },
    NETBANKING: {
        titleKey: 'checkout.payment.rail.netbankingTitle',
        titleFallback: 'NetBanking Rail Matrix',
        emptyKey: 'checkout.payment.rail.netbankingEmpty',
        emptyFallback: 'NetBanking capability data is loading from the provider.',
        format: (capability = {}, t) => {
            const banks = (capability.featuredBanks || []).slice(0, 4).map((entry) => entry.name).filter(Boolean);
            if (!capability.available) return t('checkout.payment.rail.netbankingUnavailable', {}, 'NetBanking is currently unavailable from the provider directory.');
            return t('checkout.payment.rail.netbankingFormat', {
                count: capability.bankCount || 0,
                featured: banks.length ? ` | ${t('checkout.payment.featured', {}, 'featured')}: ${banks.join(', ')}` : '',
            }, `${capability.bankCount || 0} banks live${banks.length ? ` | featured: ${banks.join(', ')}` : ''}`);
        },
    },
};

const getMarketRailSummary = (paymentMethod, marketCatalog = null, t) => {
    const rail = marketCatalog?.railMatrix?.[paymentMethod];
    if (!rail) return '';

    if (paymentMethod === 'CARD') {
        const currencyCount = (rail.currencies || []).length;
        const coverage = rail.countryMode === 'allowlist'
            ? t('checkout.payment.configuredCountries', { count: (rail.countries || []).length }, `${(rail.countries || []).length} configured countries`)
            : rail.blockedCountryCodes?.length
                ? t('checkout.payment.globalExceptBlocked', { count: rail.blockedCountryCodes.length }, `global except ${rail.blockedCountryCodes.length} blocked countries`)
                : t('checkout.payment.globalCoverage', {}, 'global country coverage');
        return t('checkout.payment.marketSummaryCard', {
            coverage,
            currencyCount,
            settlement: rail.settlementCurrency || marketCatalog?.settlementCurrency || 'INR',
        }, `${coverage} | ${currencyCount} configured currencies | settles in ${rail.settlementCurrency || marketCatalog?.settlementCurrency || 'INR'}`);
    }

    const domesticCountry = marketCatalog?.defaultCountryName || 'India';
    return t('checkout.payment.marketSummaryDomestic', {
        country: domesticCountry,
        settlement: rail.settlementCurrency || marketCatalog?.settlementCurrency || 'INR',
    }, `Domestic-only rail for ${domesticCountry} in ${rail.settlementCurrency || marketCatalog?.settlementCurrency || 'INR'}`);
};

const humanizeSavedMethod = (method, t) => {
    const type = String(method.type || '').trim().toLowerCase();
    const typeLabel = type === 'bank'
        ? t('checkout.payment.netbankingTitle', {}, 'NetBanking')
        : type === 'card'
            ? t('checkout.payment.cardTitle', {}, 'Card')
            : type === 'wallet'
                ? t('checkout.payment.walletTitle', {}, 'Wallet')
                : type === 'upi'
                    ? t('checkout.payment.upiTitle', {}, 'UPI')
                    : type.toUpperCase();
    const brand = type === 'bank'
        ? method?.metadata?.bankName || method.brand || method?.metadata?.bankCode || ''
        : method.brand || '';
    const last4 = method.last4 ? `**** ${method.last4}` : '';
    return [typeLabel, brand, last4].filter(Boolean).join(' ');
};

const humanizeProviderMethod = (method, t) => {
    if (!method) return '';
    const type = String(method.type || '').trim().toLowerCase();
    const typeLabel = type === 'bank'
        ? t('checkout.payment.netbankingTitle', {}, 'NetBanking')
        : type === 'card'
            ? t('checkout.payment.cardTitle', {}, 'Card')
            : type === 'wallet'
                ? t('checkout.payment.walletTitle', {}, 'Wallet')
                : type === 'upi'
                    ? t('checkout.payment.upiTitle', {}, 'UPI')
                    : type
                        ? type.toUpperCase()
                        : t('checkout.savedMethod', {}, 'Saved method');
    const brand = type === 'bank'
        ? method.bankName || method.brand || method.bankCode || ''
        : method.brand || '';
    const last4 = method.last4 ? `**** ${method.last4}` : '';
    return [typeLabel, brand, last4].filter(Boolean).join(' ');
};

const shortRef = (value = '') => {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (clean.length <= 14) return clean;
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
};

const isStripeSavedCard = (method = {}) => (
    String(method?.provider || '').trim().toLowerCase() === 'stripe'
    && String(method?.type || '').trim().toLowerCase() === 'card'
);

const getSavedMethodReuseLabel = (method = {}, t) => {
    const provider = String(method?.provider || '').trim().toLowerCase();
    const type = String(method?.type || '').trim().toLowerCase();
    if (provider === 'stripe' && type === 'card') {
        return t('checkout.quickPay', {}, 'Quick Pay');
    }
    if (provider === 'razorpay' && ['upi', 'wallet', 'bank'].includes(type)) {
        return t('checkout.preferred', {}, 'Preferred');
    }
    if (provider === 'razorpay' && type === 'card' && (method?.metadata?.razorpayCustomerId || method?.metadata?.customerId)) {
        return t('checkout.savedCard', {}, 'Saved Card');
    }
    return '';
};

const getLifecycleTone = (state) => {
    if (state === 'ready') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
    if (state === 'active') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100';
    if (state === 'attention') return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    if (state === 'failed') return 'border-rose-500/30 bg-rose-500/10 text-rose-100';
    return 'border-white/10 bg-white/[0.035] text-slate-300';
};

const getPaymentUnavailableReason = ({
    methodId,
    paymentCapabilities,
    selectedMarketCountryCode,
    selectedMarketCurrency,
    t,
}) => {
    const market = `${selectedMarketCountryCode || 'IN'}/${selectedMarketCurrency || 'INR'}`;
    const defaultCountry = paymentCapabilities?.markets?.defaultCountryCode || 'IN';
    const defaultCurrency = paymentCapabilities?.markets?.defaultCurrency || paymentCapabilities?.markets?.settlementCurrency || 'INR';
    const defaultMarket = `${defaultCountry}/${defaultCurrency}`;
    const rail = paymentCapabilities?.markets?.railMatrix?.[methodId] || null;

    if (rail?.available === false) {
        return t('checkout.payment.providerRailUnavailable', {}, 'Provider rail unavailable right now.');
    }

    if (methodId === 'COD') {
        return t('checkout.payment.codUnavailableForMarket', {
            market,
        }, `Cash on Delivery unavailable for ${market}.`);
    }

    if (rail?.countryMode === 'allowlist') {
        return t('checkout.payment.domesticRailUnavailable', {
            market,
            defaultMarket,
        }, `Unavailable for ${market}. Switch to ${defaultMarket} to use this rail.`);
    }

    return t('checkout.payment.marketRailUnavailable', {
        market,
    }, `Unavailable for ${market}.`);
};

const StepPayment = ({
    isActive,
    completed,
    paymentMethod,
    paymentIntent,
    paymentSession = null,
    isProcessingPayment,
    isRefreshingPayment = false,
    paymentError,
    onSetActive,
    onPaymentMethodChange,
    onExecutePayment,
    onRefreshPayment,
    onRestartPayment,
    onFallbackToCod,
    onBack,
    onContinue,
    savedMethods = [],
    selectedSavedMethodId = '',
    onSelectSavedMethod,
    challengeRequired = false,
    challengeVerified = false,
    onSendChallengeOtp,
    onMarkChallengeComplete,
    isChallengeLoading = false,
    netbankingCatalog = null,
    isNetbankingCatalogLoading = false,
    selectedNetbankingBank = null,
    onSelectNetbankingBank,
    paymentCapabilities = null,
    paymentMethods = [],
    paymentMarket = null,
    onMarketCountryChange,
    onMarketCurrencyChange,
    chargeQuote = null,
    marketOptions = MARKET_COUNTRY_PRESETS,
    currencyOptions = [],
}) => {
    const { t } = useMarket();
    const [bankSearch, setBankSearch] = useState('');
    const isDigital = paymentMethod !== 'COD';
    const isNetbanking = paymentMethod === 'NETBANKING';
    const paymentStatus = String(paymentIntent?.status || 'idle').trim().toLowerCase();
    const hasIntent = Boolean(paymentIntent?.intentId);
    const paymentReady = paymentStatus === 'authorized' || paymentStatus === 'captured';
    const actionLabel = paymentReady
        ? t('checkout.paymentAuthorized', {}, 'Payment Authorized')
        : hasIntent && paymentStatus === 'created'
            ? t('checkout.resumeSecureCheckout', {}, 'Resume Secure Checkout')
            : t('checkout.paySecurely', {}, 'Pay Securely');
    const selectedBankCode = String(selectedNetbankingBank?.code || '').trim().toUpperCase();
    const selectedMarketCountryCode = String(paymentMarket?.countryCode || 'IN').trim().toUpperCase();
    const selectedMarketCurrency = String(paymentMarket?.currency || 'INR').trim().toUpperCase();
    const enabledPaymentMethods = paymentMethods.length > 0 ? paymentMethods : PAYMENT_OPTIONS.map((option) => option.id);
    const enabledPaymentMethodSet = new Set(enabledPaymentMethods);
    const featuredBanks = Array.isArray(netbankingCatalog?.featuredBanks) ? netbankingCatalog.featuredBanks : [];
    const cardCurrencies = paymentCapabilities?.markets?.railMatrix?.CARD?.currencies || [];
    const cardCurrencyOptions = useMemo(() => {
        if (Array.isArray(currencyOptions) && currencyOptions.length > 0) {
            return currencyOptions;
        }
        if (Array.isArray(cardCurrencies) && cardCurrencies.length > 0) {
            return cardCurrencies;
        }
        return selectedMarketCurrency
            ? [{ code: selectedMarketCurrency, name: '' }]
            : [{ code: 'INR', name: t('checkout.payment.inrName', {}, 'Indian Rupee') }];
    }, [cardCurrencies, currencyOptions, selectedMarketCurrency, t]);
    const filteredBanks = useMemo(() => {
        const banks = Array.isArray(netbankingCatalog?.banks) ? netbankingCatalog.banks : [];
        const query = String(bankSearch || '').trim().toLowerCase();
        if (!query) return banks.slice(0, 18);
        return banks
            .filter((bank) => {
                const code = String(bank?.code || '').trim().toLowerCase();
                const name = String(bank?.name || '').trim().toLowerCase();
                return code.includes(query) || name.includes(query);
            })
            .slice(0, 18);
    }, [bankSearch, netbankingCatalog?.banks]);
    const paymentDisabled = isProcessingPayment
        || isRefreshingPayment
        || (challengeRequired && !challengeVerified)
        || paymentReady
        || (isNetbanking && !selectedBankCode);
    const continueDisabled = (isDigital && !paymentReady) || (isNetbanking && !selectedBankCode);
    const selectedRailSummary = RAIL_SUMMARY[paymentMethod];
    const selectedRailCapability = paymentMethod === 'UPI'
        ? paymentCapabilities?.rails?.upi
        : paymentMethod === 'CARD'
            ? paymentCapabilities?.rails?.card
            : paymentMethod === 'WALLET'
                ? paymentCapabilities?.rails?.wallet
                : paymentMethod === 'NETBANKING'
                    ? paymentCapabilities?.rails?.netbanking
                    : null;
    const selectedMarketSummary = getMarketRailSummary(paymentMethod, paymentCapabilities?.markets, t);
    const selectedPaymentOption = PAYMENT_OPTIONS.find((option) => option.id === paymentMethod) || PAYMENT_OPTIONS[0];
    const SelectedPaymentIcon = selectedPaymentOption.icon || CreditCard;
    const activeProvider = String(paymentIntent?.provider || paymentCapabilities?.provider || 'razorpay').trim().toLowerCase();
    const activeProviderLabel = activeProvider === 'stripe' ? 'Stripe' : 'Razorpay';
    const providerMethod = paymentIntent?.providerMethod || null;
    const providerMethodLabel = humanizeProviderMethod(providerMethod, t);
    const chargeLabel = chargeQuote
        ? formatPrice(chargeQuote.amount || 0, chargeQuote.currency || 'INR')
        : t('checkout.payment.amountPending', {}, 'Quote pending');
    const settlementLabel = chargeQuote?.settlementAmount
        ? formatPrice(chargeQuote.settlementAmount || 0, chargeQuote.settlementCurrency || 'INR')
        : t('checkout.payment.serverQuote', {}, 'Server quote');
    const paymentBadges = PAYMENT_BADGES[paymentMethod] || [];
    const selectedPaymentTitle = t(selectedPaymentOption.titleKey, {}, selectedPaymentOption.titleFallback);
    const lifecycleItems = [
        {
            label: t('checkout.payment.lifecycle.quote', {}, 'Amount Locked'),
            value: chargeQuote?.amount ? formatPrice(chargeQuote.amount, chargeQuote.currency || 'INR') : t('checkout.pending', {}, 'Pending'),
            state: chargeQuote?.amount ? 'ready' : 'pending',
        },
        {
            label: t('checkout.payment.lifecycle.intent', {}, 'Payment Request'),
            value: hasIntent ? shortRef(paymentIntent.intentId) : t('checkout.pending', {}, 'Pending'),
            state: hasIntent ? 'ready' : 'pending',
        },
        {
            label: t('checkout.payment.lifecycle.challenge', {}, 'Challenge'),
            value: challengeRequired
                ? (challengeVerified ? t('checkout.verified', {}, 'Verified') : t('checkout.required', {}, 'Required'))
                : t('checkout.notRequired', {}, 'Not required'),
            state: challengeRequired ? (challengeVerified ? 'ready' : 'attention') : 'ready',
        },
        {
            label: t('checkout.payment.lifecycle.provider', {}, 'Gateway'),
            value: paymentReady
                ? t('checkout.authorized', {}, 'Authorized')
                : paymentStatus === 'failed' || paymentStatus === 'expired'
                    ? paymentStatus.replace(/_/g, ' ')
                    : hasIntent
                        ? t('checkout.ready', {}, 'Ready')
                        : t('checkout.pending', {}, 'Pending'),
            state: paymentReady
                ? 'ready'
                : paymentStatus === 'failed' || paymentStatus === 'expired'
                    ? 'failed'
                    : hasIntent
                        ? 'active'
                        : 'pending',
        },
    ];
    const continueBlockedMessage = isNetbanking && !selectedBankCode
        ? t('checkout.payment.selectBankContinue', {}, 'Select a supported bank before continuing.')
        : isDigital && !paymentReady
            ? t('checkout.payment.completeSecurePaymentContinue', {}, 'Complete secure payment before continuing.')
            : '';
    const renderPaymentDiagnostics = () => (
        <>
            {selectedRailSummary ? (
                <div className="checkout-premium-alert checkout-payment-provider-alert">
                    <p className="checkout-payment-provider-alert-title">{t(selectedRailSummary.titleKey, {}, selectedRailSummary.titleFallback)}</p>
                    <p className="mt-2 text-sm leading-6">
                        {selectedRailCapability
                            ? selectedRailSummary.format(selectedRailCapability, t)
                            : t(selectedRailSummary.emptyKey, {}, selectedRailSummary.emptyFallback)}
                    </p>
                    {paymentCapabilities?.stale ? (
                        <p className="checkout-payment-provider-alert-note">{t('checkout.payment.capabilityStale', {}, 'Provider capability data is stale, so the checkout is using the last trusted catalog snapshot.')}</p>
                    ) : null}
                    {selectedMarketSummary ? (
                        <p className="checkout-payment-provider-alert-note">{selectedMarketSummary}</p>
                    ) : null}
                    <p className="checkout-payment-provider-alert-note">
                        {t('checkout.payment.providerScope', { provider: activeProviderLabel }, `Current live provider: ${activeProviderLabel}. Additional gateways appear here only after their provider implementation and credentials are enabled.`)}
                    </p>
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {lifecycleItems.map((item) => (
                    <div
                        key={item.label}
                        className={cn('rounded-2xl border p-3', getLifecycleTone(item.state))}
                    >
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-75">{item.label}</p>
                        <p className="mt-2 truncate text-sm font-bold">{item.value}</p>
                    </div>
                ))}
            </div>

            <div className="checkout-premium-alert border-white/10 bg-white/[0.035] text-slate-200">
                <div className="space-y-2 text-xs">
                    <p className="flex items-center gap-2 font-black uppercase tracking-[0.16em] text-slate-400">
                        <Server className="h-3.5 w-3.5" />
                        {t('checkout.payment.serverState', {}, 'Payment State')}
                    </p>
                    <p>{t('checkout.payment.intentRef', {}, 'Request')}: {hasIntent ? shortRef(paymentIntent.intentId) : t('checkout.pending', {}, 'Pending')}</p>
                    <p>{t('checkout.payment.provider', {}, 'Gateway')}: {paymentIntent?.provider || activeProviderLabel}</p>
                    {providerMethodLabel ? (
                        <p>{t('checkout.payment.savedMethod', {}, 'Saved method')}: {providerMethodLabel}</p>
                    ) : null}
                    <p>{t('checkout.payment.risk', {}, 'Risk')}: {paymentIntent?.riskDecision || 'allow'}</p>
                    {paymentSession?.lastSyncedAt ? (
                        <p>{t('checkout.payment.synced', {}, 'Synced')}: {new Date(paymentSession.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    ) : null}
                </div>
            </div>
        </>
    );

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
                    <CreditCard className="w-5 h-5" />
                    {t('checkout.stepPayment.title', {}, '3. Payment')}
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="space-y-6 p-6 md:p-8">
                    <div className="checkout-payment-spotlight">
                        <div className="checkout-payment-command">
                            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                                        {t('checkout.payment.amountToPay', {}, 'Amount to pay')}
                                    </p>
                                    <h4 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{chargeLabel}</h4>
                                    <p className="mt-2 text-sm leading-6 text-slate-400">
                                        {chargeQuote?.currency !== chargeQuote?.settlementCurrency
                                            ? t('checkout.payment.settlementPreview', { amount: settlementLabel }, `Settles as ${settlementLabel}`)
                                            : t('checkout.payment.lockedBeforeCapture', {}, 'Final charge is locked before capture.')}
                                    </p>
                                </div>
                                <div className="checkout-payment-method-pill">
                                    <SelectedPaymentIcon className="h-5 w-5 text-neo-cyan" />
                                    <div>
                                        <span>{t('checkout.payment.selectedRail', {}, 'Selected rail')}</span>
                                        <strong>{selectedPaymentTitle}</strong>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="checkout-payment-method-grid mt-6"
                                role="group"
                                aria-label={t('checkout.payment.methodGroup', {}, 'Payment method')}
                            >
                                {PAYMENT_OPTIONS.map((option) => {
                                    const Icon = option.icon;
                                    const selected = paymentMethod === option.id;
                                    const unavailable = !enabledPaymentMethodSet.has(option.id);
                                    const unavailableReason = unavailable
                                        ? getPaymentUnavailableReason({
                                            methodId: option.id,
                                            paymentCapabilities,
                                            selectedMarketCountryCode,
                                            selectedMarketCurrency,
                                            t,
                                        })
                                        : '';

                                    return (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                                if (!unavailable) onPaymentMethodChange(option.id);
                                            }}
                                            disabled={unavailable}
                                            aria-pressed={selected}
                                            className={cn(
                                                'checkout-premium-option checkout-payment-method-card',
                                                selected && 'checkout-premium-option-active checkout-payment-method-card-active',
                                                unavailable && 'cursor-not-allowed border-dashed opacity-60'
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className="checkout-payment-method-icon">
                                                        <Icon className="h-5 w-5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="block text-sm font-black uppercase tracking-[0.18em] text-white">{t(option.titleKey, {}, option.titleFallback)}</span>
                                                        <p className="mt-1 text-xs leading-5 text-slate-400">{t(option.descriptionKey, {}, option.descriptionFallback)}</p>
                                                    </div>
                                                </div>
                                                {selected ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-neo-cyan" /> : null}
                                            </div>
                                            {unavailableReason ? (
                                                <p className="mt-3 text-left text-xs font-semibold text-amber-200">{unavailableReason}</p>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <aside className="checkout-payment-visual" aria-label={t('checkout.payment.sessionPreview', {}, 'Payment session preview')}>
                            <div className="checkout-payment-visual-top">
                                <div>
                                    <p>{t('checkout.payment.auraPay', {}, 'Aura Pay')}</p>
                                    <h4>{selectedPaymentTitle}</h4>
                                </div>
                                <div className="checkout-payment-lock">
                                    <LockKeyhole className="h-4 w-4" />
                                </div>
                            </div>
                            <div className="checkout-payment-visual-amount">{chargeLabel}</div>
                            <div className="checkout-payment-visual-number">
                                {paymentMethod === 'CARD' ? '**** **** **** 2046' : t('checkout.payment.liveRailSession', {}, 'LIVE RAIL SESSION')}
                            </div>
                            <div className="checkout-payment-badges">
                                {paymentBadges.map((badge) => (
                                    <span key={badge}>{badge}</span>
                                ))}
                            </div>
                            <div className="checkout-payment-signal-list">
                                <span>
                                    <ShieldCheck className="h-4 w-4" />
                                    {challengeRequired && !challengeVerified
                                        ? t('checkout.payment.challengeQueued', {}, 'OTP challenge queued')
                                        : t('checkout.payment.riskChecked', {}, 'Risk checks active')}
                                </span>
                                <span>
                                    <RadioTower className="h-4 w-4" />
                                    {isDigital
                                        ? t('checkout.payment.providerRailLive', { provider: activeProviderLabel }, `${activeProviderLabel} rail live`)
                                        : t('checkout.payment.codHoldReady', {}, 'Order hold ready')}
                                </span>
                            </div>
                        </aside>
                    </div>

                    {isDigital && savedMethods.length > 0 ? (
                        <div className="checkout-premium-surface space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.savedMethods', {}, 'Saved Methods')}</p>
                            <div
                                className="space-y-3"
                                role="group"
                                aria-label={t('checkout.savedMethods', {}, 'Saved Methods')}
                            >
                                {savedMethods.map((method) => {
                                    const reuseLabel = getSavedMethodReuseLabel(method, t);
                                    return (
                                        <button
                                            key={method._id}
                                            type="button"
                                            onClick={() => onSelectSavedMethod?.(method._id)}
                                            aria-pressed={selectedSavedMethodId === method._id}
                                            className={cn(
                                                'checkout-premium-option w-full',
                                                selectedSavedMethodId === method._id && 'checkout-premium-option-active'
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-white">{humanizeSavedMethod(method, t) || t('checkout.savedMethod', {}, 'Saved method')}</span>
                                                <span className="flex flex-wrap justify-end gap-2">
                                                    {reuseLabel ? (
                                                        <span className={cn(
                                                            'premium-chip-muted text-[10px] font-black uppercase tracking-[0.2em]',
                                                            isStripeSavedCard(method) ? 'text-neo-cyan' : 'text-amber-200'
                                                        )}>{reuseLabel}</span>
                                                    ) : null}
                                                    {method.isDefault ? (
                                                        <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">{t('checkout.default', {}, 'Default')}</span>
                                                    ) : null}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : isDigital ? (
                        <div className="checkout-premium-surface space-y-3">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.methodVault', {}, 'Method Vault')}</p>
                            <div className="checkout-premium-alert border-white/10 bg-white/[0.035] text-slate-200">
                                <p className="text-sm font-semibold text-white">{t('checkout.payment.noSavedMethodsTitle', {}, 'Your next tokenized method will appear here')}</p>
                                <p className="mt-2 text-xs leading-5 text-slate-400">
                                    {t('checkout.payment.noSavedMethodsBody', { provider: activeProviderLabel }, `After a successful ${activeProviderLabel} authorization, checkout refreshes saved UPI, card, wallet, or bank methods for faster reuse.`)}
                                </p>
                            </div>
                        </div>
                    ) : null}

                    {isNetbanking ? (
                        <div className="checkout-premium-surface space-y-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.netbankingDirectory', {}, 'NetBanking Directory')}</p>
                                    <p className="mt-2 text-sm text-slate-300">{t('checkout.payment.netbankingDirectoryBody', {}, 'Pick the bank you want locked into this secure checkout session.')}</p>
                                </div>
                                {isNetbankingCatalogLoading ? (
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-neo-cyan">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t('checkout.payment.syncingBanks', {}, 'Syncing banks')}
                                    </div>
                                ) : null}
                            </div>

                            {netbankingCatalog?.stale ? (
                                <div className="checkout-premium-alert border-amber-500/30 bg-amber-500/10 text-amber-200">
                                    {t('checkout.payment.staleBankDirectory', {}, 'Live bank availability could not be refreshed, so checkout is using the last known directory.')}
                                </div>
                            ) : null}

                            {selectedNetbankingBank ? (
                                <div className="checkout-premium-alert border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                                    <p className="text-xs font-black uppercase tracking-[0.2em]">{t('checkout.payment.selectedBank', {}, 'Selected Bank')}</p>
                                    <p className="mt-2 text-sm font-semibold text-white">{selectedNetbankingBank.name}</p>
                                    <p className="mt-1 text-xs text-emerald-100/90">{t('checkout.payment.providerCode', { code: selectedNetbankingBank.code }, `Provider code: ${selectedNetbankingBank.code}`)}</p>
                                </div>
                            ) : (
                                <div className="checkout-premium-alert border-slate-500/30 bg-slate-500/10 text-slate-200">
                                    {t('checkout.payment.chooseBankBeforeLaunch', {}, 'Choose a bank before launching netbanking checkout.')}
                                </div>
                            )}

                            {featuredBanks.length > 0 ? (
                                <div className="space-y-3">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.featuredBanks', {}, 'Featured Banks')}</p>
                                    <div
                                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                                        role="group"
                                        aria-label={t('checkout.payment.featuredBanks', {}, 'Featured Banks')}
                                    >
                                        {featuredBanks.map((bank) => {
                                            const selected = selectedBankCode === String(bank.code || '').trim().toUpperCase();
                                            return (
                                                <button
                                                    key={bank.code}
                                                    type="button"
                                                    onClick={() => onSelectNetbankingBank?.(bank)}
                                                    aria-pressed={selected}
                                                    className={cn(
                                                        'checkout-premium-option text-left',
                                                        selected && 'checkout-premium-option-active'
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-black uppercase tracking-[0.18em] text-white">{bank.name}</p>
                                                            <p className="mt-1 text-[11px] text-slate-400">{bank.code}</p>
                                                        </div>
                                                        {bank.isDefaultSaved ? (
                                                            <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{t('checkout.default', {}, 'Default')}</span>
                                                        ) : bank.isSaved ? (
                                                            <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.18em] text-neo-cyan">{t('checkout.saved', {}, 'Saved')}</span>
                                                        ) : null}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}

                            <label className="block">
                                <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.searchBank', {}, 'Search Bank')}</span>
                                <div className="relative mt-3">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                    <input
                                        value={bankSearch}
                                        onChange={(event) => setBankSearch(event.target.value)}
                                        placeholder={t('checkout.payment.searchBankPlaceholder', {}, 'Search by bank name or code')}
                                        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-10 py-3 text-sm text-white outline-none transition focus:border-neo-cyan/60 focus:ring-2 focus:ring-neo-cyan/20"
                                    />
                                </div>
                            </label>

                            <div
                                className="grid grid-cols-1 gap-3 md:grid-cols-2"
                                role="group"
                                aria-label={t('checkout.payment.bankGroup', {}, 'Supported banks')}
                            >
                                {filteredBanks.map((bank) => {
                                    const selected = selectedBankCode === String(bank.code || '').trim().toUpperCase();
                                    return (
                                        <button
                                            key={bank.code}
                                            type="button"
                                            onClick={() => onSelectNetbankingBank?.(bank)}
                                            aria-pressed={selected}
                                            className={cn(
                                                'checkout-premium-option w-full text-left',
                                                selected && 'checkout-premium-option-active'
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-white">{bank.name}</p>
                                                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">{bank.code}</p>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {bank.isDefaultSaved ? (
                                                        <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{t('checkout.default', {}, 'Default')}</span>
                                                    ) : null}
                                                    {bank.isSaved && !bank.isDefaultSaved ? (
                                                        <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.18em] text-neo-cyan">{t('checkout.saved', {}, 'Saved')}</span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {!isNetbankingCatalogLoading && filteredBanks.length === 0 ? (
                                <div className="checkout-premium-alert border-slate-500/30 bg-slate-500/10 text-slate-200">
                                    {t('checkout.payment.noBankMatches', {}, 'No banks matched your search. Try the official bank code or a shorter name fragment.')}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {paymentMethod === 'CARD' ? (
                        <div className="checkout-premium-surface space-y-4">
                            <div className="checkout-card-fields" aria-label={t('checkout.payment.cardPreview', {}, 'Card checkout preview')}>
                                <div className="checkout-card-field checkout-card-field-wide">
                                    <span>{t('checkout.payment.cardNumber', {}, 'Card number')}</span>
                                    <strong>{t('checkout.payment.secureProviderWindow', {}, 'Entered in secure provider window')}</strong>
                                    <div className="checkout-card-network-row">
                                        {PAYMENT_BADGES.CARD.map((badge) => (
                                            <span key={badge}>{badge}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="checkout-card-field">
                                    <span>{t('checkout.payment.expirationDate', {}, 'Expiration date')}</span>
                                    <strong>MM / YY</strong>
                                </div>
                                <div className="checkout-card-field">
                                    <span>{t('checkout.payment.securityCode', {}, 'Security code')}</span>
                                    <strong>CVV</strong>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.cardMarket', {}, 'International Card Market')}</p>
                                <p className="mt-2 text-sm text-slate-300">{t('checkout.payment.cardMarketBody', {}, 'Lock the card country and the charge currency before opening provider checkout.')}</p>
                            </div>

                            <div
                                className="flex flex-wrap gap-2"
                                role="group"
                                aria-label={t('checkout.payment.marketCountry', {}, 'Market Country')}
                            >
                                {marketOptions.map((country) => (
                                    <button
                                        key={country.code}
                                        type="button"
                                        onClick={() => onMarketCountryChange?.(country.code)}
                                        aria-pressed={selectedMarketCountryCode === country.code}
                                        className={cn(
                                            'checkout-premium-secondary px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em]',
                                            selectedMarketCountryCode === country.code && 'border-neo-cyan/60 text-neo-cyan'
                                        )}
                                    >
                                        {country.label}
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <label className="space-y-2">
                                    <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.marketCountry', {}, 'Market Country')}</span>
                                    <input
                                        value={selectedMarketCountryCode}
                                        onChange={(event) => onMarketCountryChange?.(event.target.value)}
                                        maxLength={2}
                                        placeholder="IN"
                                        className="checkout-premium-input uppercase"
                                    />
                                </label>
                                <label className="space-y-2">
                                    <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.chargeCurrency', {}, 'Charge Currency')}</span>
                                    <select
                                        value={selectedMarketCurrency}
                                        onChange={(event) => onMarketCurrencyChange?.(event.target.value)}
                                        className="checkout-premium-input"
                                    >
                                        {cardCurrencyOptions.map((entry) => (
                                            <option key={entry.code} value={entry.code}>
                                                {entry.code} {entry.name ? `- ${entry.name}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            {chargeQuote ? (
                                <div className="checkout-premium-alert border-emerald-500/20 bg-emerald-500/10 text-emerald-100">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">{t('checkout.payment.chargeQuote', {}, 'Charge Quote')}</p>
                                    <p className="mt-2 text-sm leading-6">
                                        {formatPrice(chargeQuote.amount || 0, chargeQuote.currency || 'INR')}
                                        {chargeQuote.currency !== chargeQuote.settlementCurrency
                                            ? t('checkout.payment.targetSettlement', {
                                                amount: formatPrice(chargeQuote.settlementAmount || 0, chargeQuote.settlementCurrency || 'INR'),
                                            }, ` | target settlement ${formatPrice(chargeQuote.settlementAmount || 0, chargeQuote.settlementCurrency || 'INR')}`)
                                            : t('checkout.payment.domesticSettlement', {}, ' | domestic settlement')}
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {isDigital ? (
                        <div className="checkout-premium-surface checkout-payment-rail-panel space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                                {t('checkout.payment.secureRail', { provider: activeProviderLabel }, `${activeProviderLabel} Secure Payment`)}
                            </p>

                            <div className="hidden space-y-4 lg:block">
                                {renderPaymentDiagnostics()}
                            </div>
                            <details className="checkout-payment-details-disclosure lg:hidden">
                                <summary>
                                    <span>{t('checkout.payment.details', {}, 'Payment details')}</span>
                                    <span className="text-[10px] text-slate-400">{t('checkout.payment.detailsHint', {}, 'Rails, request, risk')}</span>
                                </summary>
                                <div className="checkout-payment-details-disclosure-body">
                                    {renderPaymentDiagnostics()}
                                </div>
                            </details>

                            {challengeRequired ? (
                                <div className="checkout-premium-alert border-amber-500/30 bg-amber-500/10 text-amber-200">
                                    <div className="flex items-center gap-2 font-semibold">
                                        <ShieldCheck className="w-4 h-4" />
                                        {t('checkout.payment.additionalVerification', {}, 'Additional verification required')}
                                    </div>
                                    <p className="mt-1 text-xs text-amber-100/90">{t('checkout.payment.runOtpChallenge', {}, 'Run payment OTP challenge before confirming payment.')}</p>
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                        <button
                                            type="button"
                                            onClick={onSendChallengeOtp}
                                            disabled={isChallengeLoading}
                                            className="checkout-premium-secondary text-xs font-black uppercase tracking-[0.2em]"
                                        >
                                            {t('checkout.payment.sendOtp', {}, 'Send OTP')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onMarkChallengeComplete}
                                            disabled={isChallengeLoading}
                                            className="checkout-premium-secondary text-xs font-black uppercase tracking-[0.2em]"
                                        >
                                            <KeyRound className="h-4 w-4" />
                                            {t('checkout.payment.verifyOtp', {}, 'Verify OTP')}
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {challengeRequired && challengeVerified ? (
                                <div className="checkout-premium-alert border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                    {t('checkout.payment.challengeComplete', {}, 'Challenge verification complete.')}
                                </div>
                            ) : null}

                            {isDigital ? (
                                <div className="flex items-center gap-2 px-1 py-1">
                                    <div className="flex h-2 w-2 animate-pulse rounded-full bg-neo-cyan shadow-[0_0_8px_var(--neo-cyan)]" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neo-cyan/80">
                                        {t('checkout.payment.routingActive', { provider: activeProviderLabel }, `${activeProviderLabel} route active`)}
                                    </span>
                                </div>
                            ) : null}

                            <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center">
                                <button
                                    type="button"
                                    onClick={onExecutePayment}
                                    disabled={paymentDisabled}
                                    className="checkout-premium-primary w-full px-5 py-3 text-xs font-black uppercase tracking-[0.2em] disabled:opacity-60 sm:w-auto"
                                >
                                    {isProcessingPayment ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t('checkout.processing', {}, 'Processing...')}
                                        </span>
                                    ) : actionLabel}
                                </button>
                                <button
                                    type="button"
                                    onClick={onRefreshPayment}
                                    disabled={!hasIntent || isProcessingPayment || isRefreshingPayment}
                                    className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.16em] disabled:opacity-50 sm:w-auto"
                                >
                                    {isRefreshingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                    {t('checkout.payment.refreshStatus', {}, 'Refresh')}
                                </button>
                                <button
                                    type="button"
                                    onClick={onRestartPayment}
                                    disabled={isProcessingPayment || isRefreshingPayment}
                                    className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.16em] disabled:opacity-50 sm:w-auto"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    {t('checkout.payment.restart', {}, 'Restart')}
                                </button>
                            </div>

                            {isNetbanking && !selectedNetbankingBank ? (
                                <p className="text-xs text-slate-400">{t('checkout.payment.selectBankUnlock', {}, 'Select a supported bank to unlock secure netbanking authorization.')}</p>
                            ) : null}

                            {paymentStatus && paymentStatus !== 'idle' ? (
                                <div className={cn('checkout-premium-alert', STATUS_STYLES[paymentStatus] || STATUS_STYLES.created)}>
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]">
                                        {t('checkout.payment.statusLabel', {}, 'Status')}: {paymentStatus.replace(/_/g, ' ')}
                                    </p>
                                    <p>{getPaymentStatusMessage(paymentIntent, t)}</p>
                                    {paymentIntent?.providerPaymentId ? (
                                        <p className="mt-2 text-xs opacity-90">{t('checkout.payment.reference', { reference: paymentIntent.providerPaymentId }, `Ref: ${paymentIntent.providerPaymentId}`)}</p>
                                    ) : null}
                                </div>
                            ) : null}

                            {!paymentReady ? (
                                <button
                                    type="button"
                                    onClick={onFallbackToCod}
                                    className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                                >
                                    {t('checkout.payment.fallbackToCod', {}, 'Use Cash on Delivery')}
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {paymentError ? (
                        <div className="checkout-premium-alert flex items-start gap-2 border-rose-500/30 bg-rose-500/10 text-rose-200">
                            <AlertCircle className="mt-0.5 w-4 h-4" />
                            <span>{paymentError}</span>
                        </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={onBack}
                            className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                        >
                            {t('checkout.back', {}, 'Back')}
                        </button>
                        <button
                            type="button"
                            onClick={onContinue}
                            disabled={continueDisabled}
                            aria-describedby={continueBlockedMessage ? 'checkout-payment-continue-hint' : undefined}
                            className="checkout-premium-primary w-full px-8 py-3 text-sm font-black uppercase tracking-[0.24em] disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:w-auto"
                        >
                            {t('checkout.continue', {}, 'Continue')}
                        </button>
                    </div>
                    {continueBlockedMessage ? (
                        <p id="checkout-payment-continue-hint" className="text-xs font-semibold text-amber-200 sm:text-right">
                            {continueBlockedMessage}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
};

export default StepPayment;
