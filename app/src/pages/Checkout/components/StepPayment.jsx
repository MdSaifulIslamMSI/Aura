import { useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, CreditCard, Loader2, Search, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
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

const StepPayment = ({
    isActive,
    completed,
    paymentMethod,
    paymentIntent,
    isProcessingPayment,
    paymentError,
    onSetActive,
    onPaymentMethodChange,
    onExecutePayment,
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
    const paymentReady = paymentStatus === 'authorized' || paymentStatus === 'captured';
    const actionLabel = paymentReady ? t('checkout.paymentAuthorized', {}, 'Payment Authorized') : t('checkout.paySecurely', {}, 'Pay Securely');
    const selectedBankCode = String(selectedNetbankingBank?.code || '').trim().toUpperCase();
    const selectedMarketCountryCode = String(paymentMarket?.countryCode || 'IN').trim().toUpperCase();
    const selectedMarketCurrency = String(paymentMarket?.currency || 'INR').trim().toUpperCase();
    const enabledPaymentMethods = paymentMethods.length > 0 ? paymentMethods : PAYMENT_OPTIONS.map((option) => option.id);
    const visiblePaymentOptions = PAYMENT_OPTIONS.filter((option) => enabledPaymentMethods.includes(option.id));
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
    }, [cardCurrencies, currencyOptions, selectedMarketCurrency]);
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
        || (challengeRequired && !challengeVerified)
        || paymentReady
        || (isNetbanking && !selectedBankCode);
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
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {visiblePaymentOptions.map((option) => {
                            const Icon = option.icon;
                            const selected = paymentMethod === option.id;

                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => onPaymentMethodChange(option.id)}
                                    className={cn(
                                        'checkout-premium-option',
                                        selected && 'checkout-premium-option-active'
                                    )}
                                >
                                    <div className="mb-2 flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <span className="text-sm font-black uppercase tracking-[0.2em] text-white">{t(option.titleKey, {}, option.titleFallback)}</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{t(option.descriptionKey, {}, option.descriptionFallback)}</p>
                                </button>
                            );
                        })}
                    </div>

                    {isDigital && savedMethods.length > 0 ? (
                        <div className="checkout-premium-surface space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.savedMethods', {}, 'Saved Methods')}</p>
                            <div className="space-y-3">
                                {savedMethods.map((method) => (
                                    <button
                                        key={method._id}
                                        type="button"
                                        onClick={() => onSelectSavedMethod?.(method._id)}
                                        className={cn(
                                            'checkout-premium-option w-full',
                                            selectedSavedMethodId === method._id && 'checkout-premium-option-active'
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold text-white">{humanizeSavedMethod(method, t) || t('checkout.savedMethod', {}, 'Saved method')}</span>
                                            {method.isDefault ? (
                                                <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">{t('checkout.default', {}, 'Default')}</span>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
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
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                        {featuredBanks.map((bank) => {
                                            const selected = selectedBankCode === String(bank.code || '').trim().toUpperCase();
                                            return (
                                                <button
                                                    key={bank.code}
                                                    type="button"
                                                    onClick={() => onSelectNetbankingBank?.(bank)}
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

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {filteredBanks.map((bank) => {
                                    const selected = selectedBankCode === String(bank.code || '').trim().toUpperCase();
                                    return (
                                        <button
                                            key={bank.code}
                                            type="button"
                                            onClick={() => onSelectNetbankingBank?.(bank)}
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
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.payment.cardMarket', {}, 'International Card Market')}</p>
                                <p className="mt-2 text-sm text-slate-300">{t('checkout.payment.cardMarketBody', {}, 'Lock the card country and the charge currency before opening provider checkout.')}</p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {marketOptions.map((country) => (
                                    <button
                                        key={country.code}
                                        type="button"
                                        onClick={() => onMarketCountryChange?.(country.code)}
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
                        <div className="checkout-premium-surface space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                                {t('checkout.payment.secureRail', {}, 'Razorpay Secure Payment')}
                            </p>

                            {selectedRailSummary ? (
                                <div className="checkout-premium-alert border-cyan-500/20 bg-cyan-500/10 text-slate-100">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">{t(selectedRailSummary.titleKey, {}, selectedRailSummary.titleFallback)}</p>
                                    <p className="mt-2 text-sm leading-6">
                                        {selectedRailCapability
                                            ? selectedRailSummary.format(selectedRailCapability, t)
                                            : t(selectedRailSummary.emptyKey, {}, selectedRailSummary.emptyFallback)}
                                    </p>
                                    {paymentCapabilities?.stale ? (
                                        <p className="mt-2 text-xs text-cyan-100/80">{t('checkout.payment.capabilityStale', {}, 'Provider capability data is stale, so the checkout is using the last trusted catalog snapshot.')}</p>
                                    ) : null}
                                    {selectedMarketSummary ? (
                                        <p className="mt-2 text-xs text-cyan-100/80">{selectedMarketSummary}</p>
                                    ) : null}
                                </div>
                            ) : null}

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
                                            {t('checkout.payment.markVerified', {}, 'Mark Verified')}
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
                                        {t('checkout.payment.routingActive', {}, 'Multi-Commodity Routing Active')}
                                    </span>
                                </div>
                            ) : null}

                            <button
                                type="button"
                                onClick={onExecutePayment}
                                disabled={paymentDisabled}
                                className="checkout-premium-primary w-full px-5 py-3 text-xs font-black uppercase tracking-[0.24em] disabled:opacity-60 sm:w-auto"
                            >
                                {isProcessingPayment ? (
                                    <span className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t('checkout.processing', {}, 'Processing...')}
                                    </span>
                                ) : actionLabel}
                            </button>

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
                                    {t('checkout.payment.fallbackToCod', {}, 'Fallback to COD')}
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
                            className="checkout-premium-primary w-full px-8 py-3 text-sm font-black uppercase tracking-[0.24em] sm:ml-auto sm:w-auto"
                        >
                            {t('checkout.continue', {}, 'Continue')}
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepPayment;
