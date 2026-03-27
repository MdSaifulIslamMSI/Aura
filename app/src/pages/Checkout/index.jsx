import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CartContext } from '@/context/CartContext';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { useCommerceStore } from '@/store/commerceStore';
import { orderApi, otpApi, paymentApi, userApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { ArrowLeft, CheckCircle2, Layers, Loader2 } from 'lucide-react';
import { loadRazorpayScript } from '@/utils/razorpay';
import { detectLocationFromGps } from '@/utils/geolocation';
import { formatPrice } from '@/utils/format';
import { getDisplayAmount, getDisplayCurrency } from '@/utils/pricing';
import StepAddress from './components/StepAddress';
import StepDelivery from './components/StepDelivery';
import StepPayment from './components/StepPayment';
import StepReview from './components/StepReview';
import OrderSummary from './components/OrderSummary';
import OtpChallengeModal from './components/OtpChallengeModal';
import useCheckoutDraft from './hooks/useCheckoutDraft';

const EMPTY_CONTACT = { name: '', phone: '', email: '' };
const EMPTY_SHIPPING = { address: '', city: '', postalCode: '', country: 'India' };
const EMPTY_SLOT = { date: '', window: '' };
const DEFAULT_MARKET = { countryCode: 'IN', currency: 'INR', language: 'en' };
const EMPTY_PAYMENT_CONTEXT = {
    market: { ...DEFAULT_MARKET },
    netbanking: {
        bankCode: '',
        bankName: '',
        source: 'manual',
    },
};
const EMPTY_INTENT = {
    intentId: '',
    provider: '',
    providerOrderId: '',
    providerPaymentId: '',
    status: 'idle',
    riskDecision: 'allow',
    challengeRequired: false,
    challengeVerified: false,
    baseAmount: 0,
    baseCurrency: 'INR',
    displayAmount: 0,
    displayCurrency: 'INR',
    settlementAmount: 0,
    settlementCurrency: 'INR',
    paymentContext: null,
    checkoutPayload: null,
};
const PAID_INTENT_STATUSES = new Set(['authorized', 'captured']);
const PAYMENT_METHOD_TO_SAVED_TYPE = {
    UPI: 'upi',
    CARD: 'card',
    WALLET: 'wallet',
    NETBANKING: 'bank',
};

const isPhoneValid = (phone) => /^\+?\d[\d\s-]{8,15}$/.test(String(phone || '').trim());
const normalizeNetbankingBankCode = (value) => String(value || '').trim().toUpperCase();
const normalizeMarketCountryCode = (value) => String(value || '').trim().toUpperCase().slice(0, 2);
const normalizeMarketCurrencyCode = (value) => String(value || '').trim().toUpperCase().slice(0, 3);
const extractNetbankingSelectionFromMethod = (method) => {
    if (String(method?.type || '').trim().toLowerCase() !== 'bank') return null;

    const bankCode = normalizeNetbankingBankCode(method?.metadata?.bankCode || method?.providerMethodId);
    if (!bankCode) return null;

    return {
        bankCode,
        bankName: String(method?.metadata?.bankName || method?.brand || bankCode).trim(),
        source: 'saved_method',
    };
};

const buildPaymentContextForQuote = (draft) => {
    const market = {
        countryCode: normalizeMarketCountryCode(draft.paymentContext?.market?.countryCode) || DEFAULT_MARKET.countryCode,
        currency: normalizeMarketCurrencyCode(draft.paymentContext?.market?.currency) || DEFAULT_MARKET.currency,
        language: String(draft.paymentContext?.market?.language || 'en').trim().toLowerCase(),
    };

    const context = { market };
    if (draft.paymentMethod === 'NETBANKING' && draft.paymentContext?.netbanking?.bankCode) {
        context.netbanking = draft.paymentContext.netbanking;
    }

    return context;
};

const isAddressValid = (shippingAddress) =>
    Boolean(
        String(shippingAddress.address || '').trim() &&
        String(shippingAddress.city || '').trim() &&
        String(shippingAddress.postalCode || '').trim() &&
        String(shippingAddress.country || '').trim()
    );

const shouldAttemptProfileRecovery = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        error?.status === 401
        || error?.status === 404
        || message.includes('missing from login database')
        || message.includes('user not found')
        || message.includes('recover your account')
    );
};

const getFallbackTotals = (items) => {
    const itemsPrice = items.reduce((sum, item) => sum + (getDisplayAmount(item) * (Number(item.quantity) || 0)), 0);
    return {
        itemsPrice,
        totalPrice: itemsPrice,
    };
};

const getQuotePayload = ({ checkoutItems, draft, checkoutSource }) => ({
    orderItems: checkoutItems.map((item) => ({
        product: item.id,
        quantity: Number(item.quantity) || 1,
    })),
    shippingAddress: {
        address: draft.shippingAddress.address,
        city: draft.shippingAddress.city,
        postalCode: draft.shippingAddress.postalCode,
        country: draft.shippingAddress.country,
    },
    paymentMethod: draft.paymentMethod,
    deliveryOption: draft.deliveryOption,
    ...(draft.deliverySlot?.date && draft.deliverySlot?.window ? { deliverySlot: draft.deliverySlot } : {}),
    couponCode: draft.couponCode,
    checkoutSource,
    paymentContext: buildPaymentContextForQuote(draft),
});

const getCompatibleSavedMethods = (methods = [], paymentMethod = 'COD') => {
    const expectedType = PAYMENT_METHOD_TO_SAVED_TYPE[String(paymentMethod || '').trim().toUpperCase()];
    if (!expectedType) return [];
    return (methods || []).filter((method) => String(method?.type || '').trim().toLowerCase() === expectedType);
};

const CHECKOUT_STEPS = [
    { id: 1, label: 'Address' },
    { id: 2, label: 'Delivery' },
    { id: 3, label: 'Payment' },
    { id: 4, label: 'Review' },
];

const Checkout = () => {
    const navigate = useNavigate();
    const { cartItems, clearCart } = useContext(CartContext);
    const { currentUser, syncUserWithBackend } = useContext(AuthContext);
    const {
        countryCode: globalCountryCode,
        currency: globalCurrency,
        languageCode: globalLanguage,
        countryOptions,
        setCountryCode: setGlobalCountryCode,
        setCurrency: setGlobalCurrency,
        t,
    } = useMarket();
    const checkoutSession = useCommerceStore((state) => state.checkoutSession);
    const clearDirectBuy = useCommerceStore((state) => state.clearDirectBuy);
    const cartRevision = useCommerceStore((state) => state.cart.revision);
    const directBuyItem = useMemo(
        () => (
            checkoutSession?.source === 'direct-buy'
                ? checkoutSession?.directBuy?.item || null
                : null
        ),
        [checkoutSession]
    );
    const checkoutSource = directBuyItem ? 'directBuy' : 'cart';

    const defaultDraft = useMemo(() => ({
        step: 1,
        checkoutSource: 'cart',
        directBuyItem: null,
        selectedAddressId: '',
        selectedSavedMethodId: '',
        addressType: 'home',
        contact: EMPTY_CONTACT,
        shippingAddress: EMPTY_SHIPPING,
        deliveryOption: 'standard',
        deliverySlot: EMPTY_SLOT,
        paymentMethod: 'COD',
        paymentContext: {
            ...EMPTY_PAYMENT_CONTEXT,
            market: {
                countryCode: globalCountryCode || EMPTY_PAYMENT_CONTEXT.market.countryCode,
                currency: globalCurrency || EMPTY_PAYMENT_CONTEXT.market.currency,
                language: globalLanguage || 'en',
            },
            netbanking: { ...EMPTY_PAYMENT_CONTEXT.netbanking },
        },
        paymentIntent: EMPTY_INTENT,
        couponCode: '',
        acceptedTerms: false,
    }), [globalCountryCode, globalCurrency, globalLanguage]);

    const { draft, setDraft, clearDraft, isHydrated } = useCheckoutDraft(currentUser?.uid, defaultDraft, {
        checkoutSource: checkoutSource === 'directBuy' ? 'direct-buy' : 'cart',
        cartRevision: checkoutSource === 'directBuy' ? 'direct-buy' : Number(cartRevision ?? 0),
    });
    const localizedCheckoutSteps = useMemo(() => ([
        { id: 1, label: t('checkout.step.address', {}, 'Address') },
        { id: 2, label: t('checkout.step.delivery', {}, 'Delivery') },
        { id: 3, label: t('checkout.step.payment', {}, 'Payment') },
        { id: 4, label: t('checkout.step.review', {}, 'Review') },
    ]), [t]);

    useEffect(() => {
        if (!isHydrated) return;

        setDraft((prev) => {
            const nextCountryCode = normalizeMarketCountryCode(globalCountryCode) || DEFAULT_MARKET.countryCode;
            const nextCurrency = normalizeMarketCurrencyCode(globalCurrency) || DEFAULT_MARKET.currency;
            const nextLanguage = String(globalLanguage || 'en').trim().toLowerCase();
            const currentCountryCode = normalizeMarketCountryCode(prev.paymentContext?.market?.countryCode);
            const currentCurrency = normalizeMarketCurrencyCode(prev.paymentContext?.market?.currency);
            const currentLanguage = String(prev.paymentContext?.market?.language || '').trim().toLowerCase();

            if (
                currentCountryCode === nextCountryCode
                && currentCurrency === nextCurrency
                && currentLanguage === nextLanguage
            ) {
                return prev;
            }

            return {
                ...prev,
                paymentIntent: EMPTY_INTENT,
                paymentContext: {
                    ...prev.paymentContext,
                    market: {
                        countryCode: nextCountryCode,
                        currency: nextCurrency,
                        language: nextLanguage,
                    },
                },
            };
        });
    }, [globalCountryCode, globalCurrency, globalLanguage, isHydrated, setDraft]);

    const [savedAddresses, setSavedAddresses] = useState([]);
    const [isLoadingProfile, setIsLoadingProfile] = useState(true);
    const [isSavingAddress, setIsSavingAddress] = useState(false);
    const [isDetectingAddressGps, setIsDetectingAddressGps] = useState(false);
    const [addressGpsHint, setAddressGpsHint] = useState('');
    const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
    const [paymentCapabilities, setPaymentCapabilities] = useState(null);
    const [checkoutConfig, setCheckoutConfig] = useState(null);
    const [netbankingCatalog, setNetbankingCatalog] = useState(null);
    const [isLoadingNetbankingCatalog, setIsLoadingNetbankingCatalog] = useState(false);
    const [stepErrors, setStepErrors] = useState({
        address: '',
        delivery: '',
        payment: '',
        review: '',
    });

    // Secure OTP modal state — replaces window.prompt()
    const [otpModal, setOtpModal] = useState({ open: false, loading: false, error: '' });
    const otpModalResolverRef = useRef(null);

    const [quote, setQuote] = useState(null);
    const [isQuoting, setIsQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState('');
    const [lastQuoteSignature, setLastQuoteSignature] = useState('');
    const [lastQuoteAt, setLastQuoteAt] = useState(0);
    const [isPlacingOrder, setIsPlacingOrder] = useState(false);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    /**
     * promptOtp — opens the secure OTP modal and returns a Promise that resolves
     * with the OTP string entered by the user, or rejects if the user cancels.
     * Replaces the insecure window.prompt() call.
     */
    const promptOtp = useCallback(() => new Promise((resolve, reject) => {
        otpModalResolverRef.current = { resolve, reject };
        setOtpModal({ open: true, loading: false, error: '' });
    }), []);

    const handleOtpModalSubmit = useCallback(async (otp) => {
        setOtpModal((prev) => ({ ...prev, loading: true, error: '' }));
        otpModalResolverRef.current?.resolve(otp);
    }, []);

    const handleOtpModalClose = useCallback(() => {
        otpModalResolverRef.current?.reject(new Error('OTP entry cancelled by user'));
        otpModalResolverRef.current = null;
        setOtpModal({ open: false, loading: false, error: '' });
    }, []);

    const handleOtpModalError = useCallback((errorMessage) => {
        setOtpModal((prev) => ({ ...prev, loading: false, error: errorMessage }));
    }, []);

    useEffect(() => {
        if (!currentUser?.email) {
            setIsLoadingProfile(false);
            return;
        }

        let isMounted = true;
        setIsLoadingProfile(true);

        const applyProfile = (profile) => {
            const addresses = profile.addresses || [];
            setSavedAddresses(addresses);

            setDraft((prev) => {
                const next = {
                    ...prev,
                    contact: {
                        ...prev.contact,
                        email: profile.email || currentUser.email || '',
                        name: prev.contact.name || profile.name || '',
                        phone: prev.contact.phone || profile.phone || '',
                    },
                };

                if (!prev.shippingAddress.address && addresses.length > 0) {
                    const preferred = addresses.find((address) => address.isDefault) || addresses[0];
                    next.selectedAddressId = preferred._id;
                    next.shippingAddress = {
                        address: preferred.address,
                        city: preferred.city,
                        postalCode: preferred.pincode,
                        country: preferred.state || 'India',
                    };
                    next.addressType = preferred.type || 'home';
                }

                return next;
            });
        };

        const hydrateProfile = async () => {
            try {
                const profile = await userApi.getProfile({ firebaseUser: currentUser });
                if (!isMounted) return;
                applyProfile(profile);
                return;
            } catch (error) {
                if (!shouldAttemptProfileRecovery(error)) {
                    throw error;
                }
                if (typeof syncUserWithBackend !== 'function') {
                    throw error;
                }

                await syncUserWithBackend(
                    currentUser.email || '',
                    currentUser.displayName || currentUser.email?.split('@')[0] || '',
                    currentUser.phoneNumber || ''
                );

                const recoveredProfile = await userApi.getProfile({ firebaseUser: currentUser });
                if (!isMounted) return;
                applyProfile(recoveredProfile);
            }
        };

        hydrateProfile()
            .catch((error) => {
                if (isMounted) {
                    toast.error(error.message || t('checkout.error.loadProfile', {}, 'Failed to load profile for checkout'));
                }
            })
            .finally(() => {
                if (isMounted) setIsLoadingProfile(false);
            });

        return () => {
            isMounted = false;
        };
    }, [currentUser, setDraft, syncUserWithBackend]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        Promise.allSettled([
            paymentApi.getMethods(),
            paymentApi.getCapabilities(),
            orderApi.getCheckoutConfig(),
        ])
            .then(([methodsResult, capabilitiesResult, checkoutConfigResult]) => {
                if (methodsResult.status === 'fulfilled') {
                    const methods = methodsResult.value || [];
                    setSavedPaymentMethods(methods);
                    setDraft((prev) => {
                        if (prev.selectedSavedMethodId) return prev;
                        const defaultMethod = (methods || []).find((method) => method.isDefault) || (methods || [])[0];
                        return {
                            ...prev,
                            selectedSavedMethodId: defaultMethod?._id || '',
                        };
                    });
                } else {
                    setSavedPaymentMethods([]);
                }

                if (capabilitiesResult.status === 'fulfilled') {
                    const capabilities = capabilitiesResult.value || null;
                    setPaymentCapabilities(capabilities);
                } else {
                    setPaymentCapabilities(null);
                }

                if (checkoutConfigResult.status === 'fulfilled') {
                    setCheckoutConfig(checkoutConfigResult.value || null);
                } else {
                    setCheckoutConfig(null);
                }
            });
    }, [currentUser?.uid, globalCountryCode, globalCurrency, globalLanguage, setDraft]);

    const checkoutItems = useMemo(() => {
        if (directBuyItem) {
            return [directBuyItem];
        }
        return cartItems;
    }, [cartItems, directBuyItem]);
    const compatibleSavedMethods = useMemo(
        () => getCompatibleSavedMethods(savedPaymentMethods, draft.paymentMethod),
        [savedPaymentMethods, draft.paymentMethod]
    );
    const selectedMarketCountryCode = normalizeMarketCountryCode(draft.paymentContext?.market?.countryCode) || DEFAULT_MARKET.countryCode;
    const selectedMarketCurrency = normalizeMarketCurrencyCode(draft.paymentContext?.market?.currency) || DEFAULT_MARKET.currency;
    const selectedNetbankingBankCode = normalizeNetbankingBankCode(draft.paymentContext?.netbanking?.bankCode);
    const selectedNetbankingBank = useMemo(() => {
        if (!selectedNetbankingBankCode) return null;

        const bankFromCatalog = (netbankingCatalog?.banks || []).find(
            (bank) => normalizeNetbankingBankCode(bank.code) === selectedNetbankingBankCode
        );
        if (bankFromCatalog) return bankFromCatalog;

        return {
            code: selectedNetbankingBankCode,
            name: draft.paymentContext?.netbanking?.bankName || selectedNetbankingBankCode,
        };
    }, [draft.paymentContext?.netbanking?.bankName, netbankingCatalog?.banks, selectedNetbankingBankCode]);

    const fallbackTotals = useMemo(() => getFallbackTotals(checkoutItems), [checkoutItems]);
    const chargeQuote = useMemo(() => ({
        amount: Number(quote?.displayAmount ?? quote?.presentmentTotalPrice ?? fallbackTotals.totalPrice ?? 0),
        currency: quote?.displayCurrency || quote?.presentmentCurrency || selectedMarketCurrency || 'INR',
        baseAmount: Number(quote?.baseAmount ?? quote?.totalPrice ?? fallbackTotals.totalPrice ?? 0),
        baseCurrency: quote?.baseCurrency || quote?.settlementCurrency || 'INR',
        settlementAmount: Number(quote?.settlementAmount ?? quote?.totalPrice ?? fallbackTotals.totalPrice ?? 0),
        settlementCurrency: quote?.settlementCurrency || 'INR',
        fxRateLocked: Number(quote?.fxRateLocked || 1),
        fxTimestamp: quote?.fxTimestamp || '',
    }), [fallbackTotals.totalPrice, quote, selectedMarketCurrency]);

    const canQuote = useMemo(
        () => checkoutItems.length > 0 && isAddressValid(draft.shippingAddress),
        [checkoutItems.length, draft.shippingAddress]
    );
    const checkoutPaymentMethods = useMemo(
        () => Array.isArray(checkoutConfig?.paymentMethods) && checkoutConfig.paymentMethods.length > 0
            ? checkoutConfig.paymentMethods
            : ['COD', 'UPI', 'CARD', 'WALLET', 'NETBANKING'],
        [checkoutConfig?.paymentMethods]
    );

    const quotePayload = useMemo(
        () => getQuotePayload({ checkoutItems, draft, checkoutSource }),
        [checkoutItems, checkoutSource, draft]
    );

    const quoteSignature = useMemo(
        () => JSON.stringify(quotePayload),
        [quotePayload]
    );

    const isQuoteStale = useMemo(() => {
        if (!quote) return true;
        if (lastQuoteSignature !== quoteSignature) return true;
        if (!lastQuoteAt) return true;
        return Date.now() - lastQuoteAt > 5 * 60 * 1000;
    }, [quote, lastQuoteAt, lastQuoteSignature, quoteSignature]);

    const requestQuote = async (payload, signature) => {
        try {
            setIsQuoting(true);
            setQuoteError('');
            const response = await orderApi.quoteOrder(payload);
            setQuote(response);
            setLastQuoteSignature(signature);
            setLastQuoteAt(Date.now());
        } catch (error) {
            setQuoteError(error.message || t('checkout.error.livePricing', {}, 'Unable to fetch live pricing'));
        } finally {
            setIsQuoting(false);
        }
    };

    useEffect(() => {
        if (!isHydrated || !canQuote) return;

        const timeout = setTimeout(() => {
            requestQuote(quotePayload, quoteSignature);
        }, 500);

        return () => clearTimeout(timeout);
    }, [canQuote, isHydrated, quotePayload, quoteSignature]);

    useEffect(() => {
        const availableMethodIds = new Set(compatibleSavedMethods.map((method) => method._id));
        const selectedSavedMethodId = String(draft.selectedSavedMethodId || '').trim();

        if (selectedSavedMethodId && availableMethodIds.has(selectedSavedMethodId)) {
            return;
        }

        const defaultMethod = compatibleSavedMethods.find((method) => method.isDefault) || compatibleSavedMethods[0];
        const nextMethodId = defaultMethod?._id || '';
        if (selectedSavedMethodId === nextMethodId) {
            return;
        }

        setDraft((prev) => ({
            ...prev,
            selectedSavedMethodId: nextMethodId,
        }));
    }, [compatibleSavedMethods, draft.selectedSavedMethodId, setDraft]);

    useEffect(() => {
        if (checkoutPaymentMethods.includes(draft.paymentMethod)) return;
        const fallbackMethod = checkoutPaymentMethods[0] || 'COD';
        setDraft((prev) => ({
            ...prev,
            paymentMethod: fallbackMethod,
            paymentIntent: EMPTY_INTENT,
            paymentContext: {
                ...prev.paymentContext,
                netbanking: fallbackMethod === 'NETBANKING'
                    ? prev.paymentContext?.netbanking || { ...EMPTY_PAYMENT_CONTEXT.netbanking }
                    : { ...EMPTY_PAYMENT_CONTEXT.netbanking },
            },
        }));
    }, [checkoutPaymentMethods, draft.paymentMethod, setDraft]);

    useEffect(() => {
        if (!currentUser?.uid || draft.paymentMethod !== 'NETBANKING' || netbankingCatalog) return;

        let cancelled = false;
        setIsLoadingNetbankingCatalog(true);

        paymentApi.getNetbankingBanks()
            .then((catalog) => {
                if (cancelled) return;
                setNetbankingCatalog(catalog || { banks: [], featuredBanks: [] });
            })
            .catch((error) => {
                if (!cancelled) {
                    setNetbankingCatalog({ banks: [], featuredBanks: [], stale: true, source: 'unavailable' });
            setStepErrors((prev) => ({
                ...prev,
                payment: error.message || t('checkout.error.netbankingUnavailable', {}, 'Unable to load supported netbanking banks right now'),
            }));
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoadingNetbankingCatalog(false);
            });

        return () => {
            cancelled = true;
        };
    }, [currentUser?.uid, draft.paymentMethod, netbankingCatalog]);

    useEffect(() => {
        if (draft.paymentMethod !== 'NETBANKING' || selectedNetbankingBankCode) return;

        const selectedSavedMethod = compatibleSavedMethods.find(
            (method) => method._id === draft.selectedSavedMethodId
        );
        const savedSelection = extractNetbankingSelectionFromMethod(selectedSavedMethod);
        if (!savedSelection) return;

        setDraft((prev) => ({
            ...prev,
            paymentContext: {
                ...prev.paymentContext,
                netbanking: savedSelection,
            },
        }));
    }, [compatibleSavedMethods, draft.paymentMethod, draft.selectedSavedMethodId, selectedNetbankingBankCode, setDraft]);

    useEffect(() => {
        if (draft.paymentMethod !== 'NETBANKING' || !selectedNetbankingBankCode || !netbankingCatalog?.banks?.length) return;

        const bankStillSupported = netbankingCatalog.banks.some(
            (bank) => normalizeNetbankingBankCode(bank.code) === selectedNetbankingBankCode
        );
        if (bankStillSupported) return;

        setDraft((prev) => ({
            ...prev,
            paymentIntent: EMPTY_INTENT,
            paymentContext: {
                ...prev.paymentContext,
                netbanking: { ...EMPTY_PAYMENT_CONTEXT.netbanking },
            },
        }));
        setStepErrors((prev) => ({
            ...prev,
            payment: 'The previously selected bank is not available right now. Choose another netbanking bank.',
        }));
    }, [draft.paymentMethod, netbankingCatalog?.banks, selectedNetbankingBankCode, setDraft]);

    const updateContactField = (key, value) => {
        setDraft((prev) => ({
            ...prev,
            contact: { ...prev.contact, [key]: value },
        }));
        setStepErrors((prev) => ({ ...prev, address: '' }));
    };

    const updateAddressField = (key, value) => {
        setAddressGpsHint('');
        setDraft((prev) => ({
            ...prev,
            shippingAddress: { ...prev.shippingAddress, [key]: value },
        }));
        setStepErrors((prev) => ({ ...prev, address: '' }));
    };

    const updateDeliverySlotField = (key, value) => {
        setDraft((prev) => ({
            ...prev,
            deliverySlot: { ...prev.deliverySlot, [key]: value },
        }));
        setStepErrors((prev) => ({ ...prev, delivery: '' }));
    };

    const selectSavedAddress = (addressId) => {
        const selected = savedAddresses.find((address) => address._id === addressId);
        if (!selected) return;
        setDraft((prev) => ({
            ...prev,
            selectedAddressId: selected._id,
            addressType: selected.type || 'home',
            contact: {
                ...prev.contact,
                name: selected.name || prev.contact.name,
                phone: selected.phone || prev.contact.phone,
            },
            shippingAddress: {
                address: selected.address || '',
                city: selected.city || '',
                postalCode: selected.pincode || '',
                country: selected.state || 'India',
            },
        }));
    };

    const getAddressPayloadFromDraft = () => ({
        type: draft.addressType,
        name: draft.contact.name.trim(),
        phone: draft.contact.phone.trim(),
        address: draft.shippingAddress.address.trim(),
        city: draft.shippingAddress.city.trim(),
        state: draft.shippingAddress.country.trim(),
        pincode: draft.shippingAddress.postalCode.trim(),
        isDefault: false,
    });

    const detectCheckoutAddressFromGps = async () => {
        try {
            setIsDetectingAddressGps(true);
            setStepErrors((prev) => ({ ...prev, address: '' }));
            setAddressGpsHint('');

            const detected = await detectLocationFromGps();
            setDraft((prev) => ({
                ...prev,
                shippingAddress: {
                    ...prev.shippingAddress,
                    city: detected.city || prev.shippingAddress.city,
                    postalCode: detected.pincode || prev.shippingAddress.postalCode,
                    country: detected.state || detected.country || prev.shippingAddress.country,
                },
            }));

            const locationParts = [detected.city, detected.state || detected.country].filter(Boolean);
            const qualityParts = [
                Number.isFinite(detected.confidence) ? t('checkout.gps.confidence', { value: detected.confidence }, `confidence ${detected.confidence}%`) : '',
                Number.isFinite(detected.accuracy) && detected.accuracy > 0 ? t('checkout.gps.accuracy', { value: Math.round(detected.accuracy) }, `${Math.round(detected.accuracy)}m accuracy`) : '',
            ].filter(Boolean);
            setAddressGpsHint(
                `${locationParts.length ? t('checkout.gps.detected', { value: locationParts.join(', ') }, `Detected ${locationParts.join(', ')}`) : t('checkout.gps.detectedFallback', {}, 'Detected location')}${
                    qualityParts.length ? ` (${qualityParts.join(', ')})` : ''
                }`
            );
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || t('checkout.error.detectLocation', {}, 'Unable to detect your location') }));
        } finally {
            setIsDetectingAddressGps(false);
        }
    };

    const saveNewAddress = async () => {
        try {
            setIsSavingAddress(true);
            const payload = getAddressPayloadFromDraft();
            const response = await userApi.addAddress(payload);
            setSavedAddresses(response.addresses || []);
            const latest = (response.addresses || []).slice(-1)[0];
            if (latest?._id) {
                setDraft((prev) => ({ ...prev, selectedAddressId: latest._id }));
            }
            toast.success(t('checkout.success.addressSaved', {}, 'Address saved'));
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || t('checkout.error.saveAddress', {}, 'Unable to save address') }));
        } finally {
            setIsSavingAddress(false);
        }
    };

    const updateSelectedAddress = async () => {
        if (!draft.selectedAddressId) {
            setStepErrors((prev) => ({ ...prev, address: t('checkout.error.selectSavedBeforeUpdate', {}, 'Select a saved address before updating') }));
            return;
        }

        try {
            setIsSavingAddress(true);
            const payload = getAddressPayloadFromDraft();
            const response = await userApi.updateAddress(draft.selectedAddressId, payload);
            setSavedAddresses(response.addresses || []);
            toast.success(t('checkout.success.addressUpdated', {}, 'Address updated'));
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || t('checkout.error.updateAddress', {}, 'Unable to update address') }));
        } finally {
            setIsSavingAddress(false);
        }
    };

    const validateAddressStep = () => {
        if (!draft.contact.name.trim()) return t('checkout.error.contactNameRequired', {}, 'Contact name is required');
        if (!isPhoneValid(draft.contact.phone)) return t('checkout.error.phoneInvalid', {}, 'Enter a valid phone number');
        if (!isAddressValid(draft.shippingAddress)) return t('checkout.error.shippingAddressRequired', {}, 'Complete shipping address is required');
        const postalPattern = checkoutConfig?.addressSchema?.postalCodePattern;
        if (postalPattern) {
            try {
                const regex = new RegExp(postalPattern, 'i');
                if (!regex.test(String(draft.shippingAddress.postalCode || '').trim())) {
                    return t('checkout.error.postalInvalid', {
                        label: checkoutConfig?.addressSchema?.postalCodeLabel || 'Postal code',
                    }, `${checkoutConfig?.addressSchema?.postalCodeLabel || 'Postal code'} format is invalid for the selected market`);
                }
            } catch {
                // Ignore malformed remote regex patterns.
            }
        }
        return '';
    };

    const validateDeliveryStep = () => {
        if (!draft.deliverySlot.date) return t('checkout.error.deliveryDate', {}, 'Select a delivery date');
        if (!draft.deliverySlot.window) return t('checkout.error.deliveryWindow', {}, 'Select a delivery window');
        return '';
    };

    const validatePaymentStep = () => {
        if (!draft.paymentMethod) return t('checkout.error.choosePaymentMethod', {}, 'Choose a payment method');
        if (!checkoutPaymentMethods.includes(draft.paymentMethod)) {
            return t('checkout.error.paymentMethodUnavailable', {}, 'The selected payment method is not available in this market');
        }
        if (draft.paymentMethod === 'NETBANKING' && !selectedNetbankingBankCode) {
            return t('checkout.error.netbankingBankRequired', {}, 'Choose a supported bank for NetBanking before continuing');
        }
        if (draft.paymentMethod !== 'COD' && !PAID_INTENT_STATUSES.has(String(draft.paymentIntent.status || '').toLowerCase())) {
            return t('checkout.error.completeDigitalPayment', {}, 'Complete secure digital payment before continuing');
        }
        return '';
    };

    const gotoStep = (targetStep) => {
        setDraft((prev) => ({ ...prev, step: targetStep }));
    };

    const handleAddressContinue = () => {
        const error = validateAddressStep();
        if (error) {
            setStepErrors((prev) => ({ ...prev, address: error }));
            return;
        }
        gotoStep(2);
    };

    const handleDeliveryContinue = () => {
        const error = validateDeliveryStep();
        if (error) {
            setStepErrors((prev) => ({ ...prev, delivery: error }));
            return;
        }
        gotoStep(3);
    };

    const handlePaymentContinue = () => {
        const error = validatePaymentStep();
        if (error) {
            setStepErrors((prev) => ({ ...prev, payment: error }));
            return;
        }
        gotoStep(4);
    };

    const handlePaymentMethodChange = (method) => {
        setDraft((prev) => ({
            ...prev,
            paymentMethod: method,
            paymentContext: {
                ...prev.paymentContext,
                market: {
                    countryCode: normalizeMarketCountryCode(prev.paymentContext?.market?.countryCode) || DEFAULT_MARKET.countryCode,
                    currency: normalizeMarketCurrencyCode(prev.paymentContext?.market?.currency) || DEFAULT_MARKET.currency,
                    language: String(prev.paymentContext?.market?.language || globalLanguage || 'en').trim().toLowerCase(),
                },
                netbanking: method === 'NETBANKING'
                    ? prev.paymentContext?.netbanking || { ...EMPTY_PAYMENT_CONTEXT.netbanking }
                    : { ...EMPTY_PAYMENT_CONTEXT.netbanking },
            },
            paymentIntent: EMPTY_INTENT,
        }));
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const handleMarketCountryChange = (value) => {
        const nextCountryCode = normalizeMarketCountryCode(value);
        setGlobalCountryCode(nextCountryCode || DEFAULT_MARKET.countryCode);
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const handleMarketCurrencyChange = (value) => {
        const nextCurrency = normalizeMarketCurrencyCode(value);
        setGlobalCurrency(nextCurrency || DEFAULT_MARKET.currency);
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const handleSelectSavedMethod = (methodId) => {
        const selectedMethod = compatibleSavedMethods.find((method) => method._id === methodId);
        const savedSelection = draft.paymentMethod === 'NETBANKING'
            ? extractNetbankingSelectionFromMethod(selectedMethod)
            : null;

        setDraft((prev) => ({
            ...prev,
            selectedSavedMethodId: methodId,
            paymentIntent: PAID_INTENT_STATUSES.has(String(prev.paymentIntent.status || '').toLowerCase())
                ? prev.paymentIntent
                : EMPTY_INTENT,
            paymentContext: savedSelection
                ? {
                    ...prev.paymentContext,
                    netbanking: savedSelection,
                }
                : prev.paymentContext,
        }));
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const handleSelectNetbankingBank = (bank) => {
        const normalizedBankCode = normalizeNetbankingBankCode(bank?.code);
        if (!normalizedBankCode) return;

        const matchingSavedMethod = compatibleSavedMethods.find((method) => {
            const savedSelection = extractNetbankingSelectionFromMethod(method);
            return savedSelection?.bankCode === normalizedBankCode;
        });

        setDraft((prev) => ({
            ...prev,
            selectedSavedMethodId: matchingSavedMethod?._id || '',
            paymentIntent: PAID_INTENT_STATUSES.has(String(prev.paymentIntent.status || '').toLowerCase())
                ? prev.paymentIntent
                : EMPTY_INTENT,
            paymentContext: {
                ...prev.paymentContext,
                netbanking: {
                    bankCode: normalizedBankCode,
                    bankName: String(bank?.name || normalizedBankCode).trim(),
                    source: matchingSavedMethod ? 'saved_method' : 'catalog',
                },
            },
        }));
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const openRazorpayCheckout = async ({ intentId, checkoutPayload }) => {
        if (!intentId || !checkoutPayload?.orderId) {
            throw new Error(t('checkout.error.checkoutPayloadMissing', {}, 'Payment checkout payload is missing. Please retry.'));
        }

        await loadRazorpayScript();
        await new Promise((resolve, reject) => {
            const rzp = new window.Razorpay({
                ...checkoutPayload,
                handler: async (paymentResponse) => {
                    try {
                        const confirmResult = await paymentApi.confirmIntent(intentId, {
                            providerPaymentId: paymentResponse.razorpay_payment_id,
                            providerOrderId: paymentResponse.razorpay_order_id,
                            providerSignature: paymentResponse.razorpay_signature,
                        });
                        setDraft((prev) => ({
                            ...prev,
                            paymentIntent: {
                                ...prev.paymentIntent,
                                intentId,
                                providerPaymentId: paymentResponse.razorpay_payment_id,
                                status: confirmResult.status,
                                baseAmount: confirmResult.baseAmount ?? prev.paymentIntent.baseAmount ?? 0,
                                baseCurrency: confirmResult.baseCurrency || prev.paymentIntent.baseCurrency || 'INR',
                                displayAmount: confirmResult.displayAmount ?? prev.paymentIntent.displayAmount ?? 0,
                                displayCurrency: confirmResult.displayCurrency || prev.paymentIntent.displayCurrency || 'INR',
                                settlementAmount: confirmResult.settlementAmount ?? prev.paymentIntent.settlementAmount ?? 0,
                                settlementCurrency: confirmResult.settlementCurrency || prev.paymentIntent.settlementCurrency || 'INR',
                            },
                        }));
                        toast.success(t('checkout.success.paymentAuthorized', {}, 'Payment authorized successfully'));
                        resolve();
                    } catch (confirmError) {
                        reject(confirmError);
                    }
                },
                modal: {
                    ondismiss: () => reject(new Error(t('checkout.error.paymentClosed', {}, 'Payment window closed before completion'))),
                },
            });
            rzp.open();
        });
    };

    const executeDigitalPayment = async () => {
        if (draft.paymentMethod === 'COD') return;
        try {
            setIsProcessingPayment(true);
            setStepErrors((prev) => ({ ...prev, payment: '' }));

            if (PAID_INTENT_STATUSES.has(String(draft.paymentIntent.status || '').toLowerCase())) {
                toast.success(t('checkout.success.paymentAlreadyAuthorized', {}, 'Payment is already authorized for this checkout session'));
                return;
            }

            const hasReusableIntent = (
                draft.paymentIntent.intentId
                && draft.paymentIntent.checkoutPayload
                && String(draft.paymentIntent.status || '').toLowerCase() === 'created'
                && (
                    draft.paymentMethod !== 'NETBANKING'
                    || normalizeNetbankingBankCode(draft.paymentIntent.paymentContext?.netbanking?.bankCode)
                        === selectedNetbankingBankCode
                )
                && (!draft.paymentIntent.challengeRequired || draft.paymentIntent.challengeVerified)
            );

            if (hasReusableIntent) {
                await openRazorpayCheckout({
                    intentId: draft.paymentIntent.intentId,
                    checkoutPayload: draft.paymentIntent.checkoutPayload,
                });
                return;
            }

            const quoteSnapshot = {
                totalPrice: quote?.totalPrice || fallbackTotals.totalPrice,
                baseAmount: quote?.baseAmount || chargeQuote.baseAmount,
                baseCurrency: quote?.baseCurrency || chargeQuote.baseCurrency,
                displayAmount: chargeQuote.amount,
                displayCurrency: chargeQuote.currency,
                fxRateLocked: quote?.fxRateLocked || chargeQuote.fxRateLocked,
                fxTimestamp: quote?.fxTimestamp || chargeQuote.fxTimestamp,
                presentmentTotalPrice: chargeQuote.amount,
                presentmentCurrency: chargeQuote.currency,
                pricingVersion: quote?.pricingVersion || 'v2',
            };

            const intent = await paymentApi.createIntent({
                quotePayload,
                quoteSnapshot,
                paymentMethod: draft.paymentMethod,
                savedMethodId: draft.selectedSavedMethodId || undefined,
                paymentContext: draft.paymentContext,
                deviceContext: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language,
                    screen: `${window.screen.width}x${window.screen.height}`,
                },
            });

            setDraft((prev) => ({
                ...prev,
                paymentIntent: {
                    intentId: intent.intentId,
                    provider: intent.provider,
                    providerOrderId: intent.providerOrderId,
                    providerPaymentId: '',
                    status: intent.status,
                    riskDecision: intent.riskDecision,
                    challengeRequired: Boolean(intent.challengeRequired),
                    challengeVerified: false,
                    baseAmount: intent.baseAmount ?? chargeQuote.baseAmount,
                    baseCurrency: intent.baseCurrency || chargeQuote.baseCurrency || 'INR',
                    displayAmount: intent.displayAmount ?? chargeQuote.amount,
                    displayCurrency: intent.displayCurrency || chargeQuote.currency || 'INR',
                    settlementAmount: intent.settlementAmount ?? chargeQuote.settlementAmount,
                    settlementCurrency: intent.settlementCurrency || chargeQuote.settlementCurrency || 'INR',
                    paymentContext: intent.paymentContext || null,
                    checkoutPayload: intent.checkoutPayload || null,
                },
            }));

            if (intent.challengeRequired) {
                toast.warning(t('checkout.warning.otpRequired', {}, 'Additional OTP verification is required before payment confirmation'));
                return;
            }

            await openRazorpayCheckout({
                intentId: intent.intentId,
                checkoutPayload: intent.checkoutPayload,
            });
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, payment: error.message || t('checkout.error.paymentAuthorizationFailed', {}, 'Payment authorization failed') }));
        } finally {
            setIsProcessingPayment(false);
        }
    };

    const sendPaymentChallengeOtp = async () => {
        if (!draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, payment: t('checkout.error.createPaymentFirst', {}, 'Create payment authorization first') }));
            return;
        }
        try {
            setIsProcessingPayment(true);
            await otpApi.sendOtp(draft.contact.email, draft.contact.phone, 'payment-challenge');
            toast.success(t('checkout.success.challengeOtpSent', {}, 'Payment challenge OTP sent'));
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, payment: error.message || t('checkout.error.sendChallengeOtp', {}, 'Failed to send challenge OTP') }));
        } finally {
            setIsProcessingPayment(false);
        }
    };

    const markPaymentChallengeComplete = async () => {
        if (!draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, payment: t('checkout.error.createPaymentFirst', {}, 'Create payment authorization first') }));
            return;
        }

        let otp;
        try {
            // Secure modal-driven OTP — replaces window.prompt() which was
            // interceptable by browser extensions and phishing overlays.
            otp = await promptOtp();
        } catch {
            // User cancelled the modal
            setOtpModal({ open: false, loading: false, error: '' });
            return;
        }

        try {
            setIsProcessingPayment(true);
            const otpResult = await otpApi.verifyOtp(
                draft.contact.phone,
                String(otp),
                'payment-challenge',
                draft.paymentIntent.intentId
            );
            if (!otpResult?.challengeToken) {
                throw new Error(t('checkout.error.challengeTokenMissing', {}, 'Challenge token missing after OTP verification'));
            }
            await paymentApi.completeChallenge(draft.paymentIntent.intentId, {
                challengeToken: otpResult.challengeToken,
            });

            // Close modal on success
            setOtpModal({ open: false, loading: false, error: '' });
            otpModalResolverRef.current = null;

            setDraft((prev) => ({
                ...prev,
                paymentIntent: {
                    ...prev.paymentIntent,
                    challengeVerified: true,
                    challengeRequired: true,
                    status: 'created',
                },
            }));
            toast.success(t('checkout.success.challengeVerified', {}, 'Challenge verification complete. Opening secure checkout...'));
            await openRazorpayCheckout({
                intentId: draft.paymentIntent.intentId,
                checkoutPayload: draft.paymentIntent.checkoutPayload,
            });
        } catch (error) {
            // Show error inside modal instead of closing
            handleOtpModalError(error.message || t('checkout.error.otpVerification', {}, 'OTP verification failed'));
            setStepErrors((prev) => ({ ...prev, payment: error.message || t('checkout.error.paymentChallengeVerification', {}, 'Payment challenge verification failed') }));
        } finally {
            setIsProcessingPayment(false);
        }
    };

    const fallbackToCod = () => {
        setDraft((prev) => ({
            ...prev,
            paymentMethod: 'COD',
            paymentContext: {
                ...prev.paymentContext,
                netbanking: { ...EMPTY_PAYMENT_CONTEXT.netbanking },
            },
            paymentIntent: EMPTY_INTENT,
        }));
        toast.info(t('checkout.info.switchedToCod', {}, 'Switched to Cash on Delivery'));
    };

    const applyCoupon = async () => {
        if (!draft.couponCode.trim()) {
            setStepErrors((prev) => ({ ...prev, review: t('checkout.error.enterCoupon', {}, 'Enter a coupon code first') }));
            return;
        }

        await requestQuote(
            { ...quotePayload, couponCode: draft.couponCode.trim().toUpperCase() },
            JSON.stringify({ ...quotePayload, couponCode: draft.couponCode.trim().toUpperCase() })
        );
        setStepErrors((prev) => ({ ...prev, review: '' }));
    };

    const removeCoupon = async () => {
        setDraft((prev) => ({ ...prev, couponCode: '' }));
        await requestQuote(
            { ...quotePayload, couponCode: '' },
            JSON.stringify({ ...quotePayload, couponCode: '' })
        );
    };

    const placeOrder = async () => {
        if (!draft.acceptedTerms) {
            setStepErrors((prev) => ({ ...prev, review: t('checkout.error.acceptTerms', {}, 'Accept the checkout terms before placing order') }));
            return;
        }
        if (isQuoteStale) {
            setStepErrors((prev) => ({ ...prev, review: t('checkout.error.quoteStale', {}, 'Quote is stale. Recalculate before placing order.') }));
            return;
        }
        if (draft.paymentMethod !== 'COD' && !PAID_INTENT_STATUSES.has(String(draft.paymentIntent.status || '').toLowerCase())) {
            setStepErrors((prev) => ({ ...prev, review: t('checkout.error.paymentNotConfirmed', {}, 'Digital payment is not confirmed yet.') }));
            return;
        }
        if (draft.paymentMethod !== 'COD' && !draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, review: t('checkout.error.paymentIntentMissing', {}, 'Payment intent is missing. Please retry payment.') }));
            return;
        }

        try {
            setIsPlacingOrder(true);
            setStepErrors((prev) => ({ ...prev, review: '' }));

            const payload = {
                orderItems: checkoutItems.map((item) => ({
                    product: item.id,
                    quantity: Number(item.quantity) || 1,
                })),
                shippingAddress: draft.shippingAddress,
                paymentMethod: draft.paymentMethod,
                deliveryOption: draft.deliveryOption,
                deliverySlot: draft.deliverySlot,
                couponCode: draft.couponCode,
                checkoutSource,
                paymentContext: buildPaymentContextForQuote(draft),
                paymentIntentId: draft.paymentIntent.intentId || undefined,
                quoteSnapshot: {
                    totalPrice: quote.totalPrice,
                    baseAmount: quote.baseAmount,
                    baseCurrency: quote.baseCurrency,
                    displayAmount: chargeQuote.amount,
                    displayCurrency: chargeQuote.currency,
                    fxRateLocked: quote.fxRateLocked,
                    fxTimestamp: quote.fxTimestamp,
                    presentmentTotalPrice: chargeQuote.amount,
                    presentmentCurrency: chargeQuote.currency,
                    pricingVersion: quote.pricingVersion || 'v2',
                },
                // crypto.randomUUID() is collision-safe (RFC 4122 UUID v4).
                // Math.random() was used previously but is not cryptographically
                // secure and could produce duplicates under concurrent submissions.
                idempotencyKey: crypto.randomUUID(),
            };

            const createdOrder = await orderApi.createOrder(payload);

            if (checkoutSource !== 'directBuy') {
                clearCart();
            } else {
                clearDirectBuy();
            }

            clearDraft();
            toast.success(t('checkout.success.orderPlaced', {}, 'Order placed successfully'));
            navigate('/orders', {
                state: { orderPlaced: true, orderId: createdOrder?._id },
            });
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, review: error.message || t('checkout.error.orderPlacementFailed', {}, 'Order placement failed') }));
        } finally {
            setIsPlacingOrder(false);
        }
    };

    if (checkoutItems.length === 0 && !isLoadingProfile) {
        return (
            <div className="checkout-premium-shell min-h-screen flex items-center justify-center px-4 py-20">
                <div className="premium-panel premium-grid-backdrop relative z-10 w-full max-w-xl p-8 text-center">
                    <span className="premium-eyebrow">{t('checkout.emptyEyebrow', {}, 'Checkout Studio')}</span>
                    <h2 className="mt-5 text-3xl font-black tracking-tight text-white">{t('checkout.emptyTitle', {}, 'Nothing queued for checkout')}</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{t('checkout.emptyBody', {}, 'Add products to your bag or jump back into the marketplace to build your next premium order.')}</p>
                    <button onClick={() => navigate('/')} className="checkout-premium-primary mt-8 w-full sm:w-auto px-8 py-3 text-sm font-black uppercase tracking-[0.22em]">{t('checkout.continueShopping', {}, 'Continue Shopping')}</button>
                </div>
            </div>
        );
    }

    if (!isHydrated || isLoadingProfile) {
        return (
            <div className="checkout-premium-shell min-h-screen flex items-center justify-center px-4">
                <div className="premium-panel premium-grid-backdrop relative z-10 w-full max-w-lg p-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                        <Loader2 className="w-6 h-6 animate-spin text-neo-cyan" />
                    </div>
                    <p className="premium-kicker">{t('checkout.loadingKicker', {}, 'Aura Payment Rail')}</p>
                    <h2 className="mt-3 text-2xl font-black text-white">{t('checkout.loadingTitle', {}, 'Preparing a secure session')}</h2>
                    <p className="mt-3 text-sm text-slate-400">{t('checkout.loadingBody', {}, 'Loading your profile, payment methods, delivery preferences, and quote context.')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="checkout-premium-shell min-h-screen pb-20">
            <div className="sticky top-20 md:top-24 z-40 px-4 pt-4">
                <div className="container-custom">
                    <div className="checkout-premium-toolbar">
                        <div className="flex flex-col gap-4 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => navigate(-1)}
                                    className="checkout-premium-secondary"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    {t('checkout.back', {}, 'Back')}
                                </button>
                                <div className="hidden sm:flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                                    <Layers className="w-4 h-4 text-neo-cyan" />
                                    {t('checkout.secureRail', {}, 'Secure checkout rail')}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {localizedCheckoutSteps.map((step) => (
                                    <button
                                        key={step.id}
                                        type="button"
                                        onClick={() => (draft.step >= step.id ? gotoStep(step.id) : null)}
                                        className={cn(
                                            'checkout-premium-step-pill text-xs font-black uppercase tracking-[0.18em]',
                                            draft.step === step.id && 'checkout-premium-step-pill-active'
                                        )}
                                    >
                                        <span className="text-[10px] opacity-70">0{step.id}</span>
                                        {step.label}
                                        {draft.step > step.id ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="checkout-premium-content container-custom py-8 space-y-8">
                <section className="checkout-premium-hero">
                    <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)] xl:items-end">
                        <div>
                            <span className="premium-eyebrow">{t('checkout.heroEyebrow', {}, 'Aura Secure Checkout')}</span>
                            <h1 className="mt-5 text-3xl font-black tracking-tight text-white md:text-5xl">{t('checkout.heroTitle', {}, 'Finish with the same premium precision as the storefront.')}</h1>
                            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                                {t('checkout.heroBody', {}, 'Your delivery address, slot, payment challenge, and final quote stay synchronized in one protected checkout session.')}
                            </p>
                            <div className="mt-5 flex flex-wrap gap-3">
                                <span className="premium-chip">{t('checkout.lineItems', { count: checkoutItems.length }, `${checkoutItems.length} line items`)}</span>
                                <span className="premium-chip-muted">{t('checkout.stepProgress', { current: draft.step, total: 4 }, `Step ${draft.step} of 4`)}</span>
                                <span className="premium-chip-muted">{t('checkout.paymentRail', { method: draft.paymentMethod }, `${draft.paymentMethod} payment rail`)}</span>
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                            <div className="checkout-premium-surface">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.currentTotal', {}, 'Current total')}</p>
                                <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatPrice(chargeQuote.amount, chargeQuote.currency)}</p>
                                <p className="mt-2 text-xs text-slate-400">
                                    {chargeQuote.currency !== chargeQuote.settlementCurrency
                                        ? t('checkout.settlesNear', {
                                            amount: formatPrice(chargeQuote.settlementAmount, chargeQuote.settlementCurrency),
                                        }, `Settles near ${formatPrice(chargeQuote.settlementAmount, chargeQuote.settlementCurrency)} after provider conversion.`)
                                        : t('checkout.backendValidated', {}, 'Backend validated before capture.')}
                                </p>
                            </div>
                            <div className="checkout-premium-surface">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.deliveryMode', {}, 'Delivery mode')}</p>
                                <p className="mt-3 text-xl font-black text-white capitalize">{draft.deliveryOption}</p>
                                <p className="mt-2 text-xs text-slate-400">{draft.deliverySlot.window || t('checkout.choosePreferredWindow', {}, 'Choose your preferred window.')}</p>
                            </div>
                            <div className="checkout-premium-surface">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.sessionTrust', {}, 'Session trust')}</p>
                                <p className="mt-3 text-xl font-black text-white">{draft.paymentMethod === 'COD' ? t('checkout.protectedOrderHold', {}, 'Protected order hold') : t('checkout.challengeReadyPayment', {}, 'Challenge-ready payment')}</p>
                                <p className="mt-2 text-xs text-slate-400">{t('checkout.sessionTrustBody', {}, 'Fraud checks, quote locks, and OTP controls stay active.')}</p>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                    <StepAddress
                        isActive={draft.step === 1}
                        completed={draft.step > 1}
                        contact={draft.contact}
                        shippingAddress={draft.shippingAddress}
                        addressSchema={checkoutConfig?.addressSchema || {}}
                        savedAddresses={savedAddresses}
                        selectedAddressId={draft.selectedAddressId}
                        addressType={draft.addressType}
                        isSavingAddress={isSavingAddress}
                        isDetectingGps={isDetectingAddressGps}
                        gpsHint={addressGpsHint}
                        addressError={stepErrors.address}
                        onSetActive={() => gotoStep(1)}
                        onContactChange={updateContactField}
                        onAddressChange={updateAddressField}
                        onAddressTypeChange={(type) => setDraft((prev) => ({ ...prev, addressType: type }))}
                        onSelectSavedAddress={selectSavedAddress}
                        onSaveNewAddress={saveNewAddress}
                        onUpdateSelectedAddress={updateSelectedAddress}
                        onDetectGps={detectCheckoutAddressFromGps}
                        onContinue={handleAddressContinue}
                    />

                    <StepDelivery
                        isActive={draft.step === 2}
                        completed={draft.step > 2}
                        deliveryOption={draft.deliveryOption}
                        deliverySlot={draft.deliverySlot}
                        shippingOptions={checkoutConfig?.shippingOptions || []}
                        optimizedSlots={quote?.pricing?.optimizedSlots || []}
                        deliveryError={stepErrors.delivery}
                        onSetActive={() => draft.step > 1 && gotoStep(2)}
                        onDeliveryOptionChange={(option) => setDraft((prev) => ({ ...prev, deliveryOption: option }))}
                        onDeliverySlotChange={updateDeliverySlotField}
                        onBack={() => gotoStep(1)}
                        onContinue={handleDeliveryContinue}
                    />

                    <StepPayment
                        isActive={draft.step === 3}
                        completed={draft.step > 3}
                        paymentMethod={draft.paymentMethod}
                        paymentIntent={draft.paymentIntent}
                        isProcessingPayment={isProcessingPayment}
                        paymentError={stepErrors.payment}
                        savedMethods={compatibleSavedMethods}
                        selectedSavedMethodId={draft.selectedSavedMethodId}
                        onSelectSavedMethod={handleSelectSavedMethod}
                        challengeRequired={Boolean(draft.paymentIntent.challengeRequired)}
                        challengeVerified={Boolean(draft.paymentIntent.challengeVerified)}
                        onSendChallengeOtp={sendPaymentChallengeOtp}
                        onMarkChallengeComplete={markPaymentChallengeComplete}
                        isChallengeLoading={isProcessingPayment}
                        paymentCapabilities={paymentCapabilities}
                        paymentMethods={checkoutPaymentMethods}
                        onSetActive={() => draft.step > 2 && gotoStep(3)}
                        onPaymentMethodChange={handlePaymentMethodChange}
                        netbankingCatalog={netbankingCatalog}
                        isNetbankingCatalogLoading={isLoadingNetbankingCatalog}
                        selectedNetbankingBank={selectedNetbankingBank}
                        onSelectNetbankingBank={handleSelectNetbankingBank}
                        paymentMarket={{
                            countryCode: selectedMarketCountryCode,
                            currency: selectedMarketCurrency,
                        }}
                        onMarketCountryChange={handleMarketCountryChange}
                        onMarketCurrencyChange={handleMarketCurrencyChange}
                        chargeQuote={chargeQuote}
                        marketOptions={(countryOptions || []).map((option) => ({
                            code: option.value,
                            label: option.label,
                        }))}
                        currencyOptions={paymentCapabilities?.markets?.railMatrix?.CARD?.currencies || []}
                        onExecutePayment={executeDigitalPayment}
                        onFallbackToCod={fallbackToCod}
                        onBack={() => gotoStep(2)}
                        onContinue={handlePaymentContinue}
                    />

                    <StepReview
                        isActive={draft.step === 4}
                        completed={false}
                        contact={draft.contact}
                        shippingAddress={draft.shippingAddress}
                        deliveryOption={draft.deliveryOption}
                        deliverySlot={draft.deliverySlot}
                        paymentMethod={draft.paymentMethod}
                        quote={quote}
                        acceptedTerms={draft.acceptedTerms}
                        reviewError={stepErrors.review}
                        isPlacingOrder={isPlacingOrder}
                        onSetActive={() => draft.step > 3 && gotoStep(4)}
                        onAcceptedTermsChange={(value) => setDraft((prev) => ({ ...prev, acceptedTerms: value }))}
                        onBack={() => gotoStep(3)}
                        onPlaceOrder={placeOrder}
                    />
                    </div>

                    <OrderSummary
                        items={checkoutItems}
                        quote={quote}
                        fallbackTotals={fallbackTotals}
                        chargeQuote={chargeQuote}
                        isQuoting={isQuoting}
                        quoteError={quoteError}
                        isQuoteStale={isQuoteStale}
                        couponCode={draft.couponCode}
                        onCouponCodeChange={(value) => setDraft((prev) => ({ ...prev, couponCode: value }))}
                        onApplyCoupon={applyCoupon}
                        onRemoveCoupon={removeCoupon}
                        onRecalculate={() => requestQuote(quotePayload, quoteSignature)}
                    />
                </div>
            </div>

            {isPlacingOrder ? (
                <div className="fixed inset-0 bg-zinc-950/70 z-50 flex items-center justify-center">
                    <div className="premium-panel premium-grid-backdrop w-full max-w-sm p-6 text-center text-slate-200">
                        <Loader2 className="w-6 h-6 animate-spin text-neo-cyan mx-auto mb-3" />
                        <p className="font-bold uppercase tracking-wider text-sm">{t('checkout.placingOrder', {}, 'Placing your order...')}</p>
                        <p className="text-xs text-slate-400 mt-1">{t('checkout.validatingOrder', {}, 'Validating stock and final pricing')}</p>
                    </div>
                </div>
            ) : null}

            {/* Secure OTP Challenge Modal — replaces window.prompt() */}
            <OtpChallengeModal
                open={otpModal.open}
                loading={otpModal.loading}
                error={otpModal.error}
                onSubmit={handleOtpModalSubmit}
                onClose={handleOtpModalClose}
            />
        </div>
    );
};

export default Checkout;
