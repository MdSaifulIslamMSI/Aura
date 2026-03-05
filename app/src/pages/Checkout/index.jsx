import { useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CartContext } from '@/context/CartContext';
import { AuthContext } from '@/context/AuthContext';
import { orderApi, otpApi, paymentApi, userApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { ArrowLeft, CheckCircle2, Layers, Loader2 } from 'lucide-react';
import { loadRazorpayScript } from '@/utils/razorpay';
import { detectLocationFromGps } from '@/utils/geolocation';
import StepAddress from './components/StepAddress';
import StepDelivery from './components/StepDelivery';
import StepPayment from './components/StepPayment';
import StepReview from './components/StepReview';
import OrderSummary from './components/OrderSummary';
import useCheckoutDraft from './hooks/useCheckoutDraft';

const EMPTY_CONTACT = { name: '', phone: '', email: '' };
const EMPTY_SHIPPING = { address: '', city: '', postalCode: '', country: 'India' };
const EMPTY_SLOT = { date: '', window: '' };
const EMPTY_SIMULATION = { status: 'idle', referenceId: '', message: '', attemptToken: '' };
const EMPTY_INTENT = {
    intentId: '',
    provider: '',
    providerOrderId: '',
    status: 'idle',
    riskDecision: 'allow',
    challengeRequired: false,
    challengeVerified: false,
    checkoutPayload: null,
};
const PAYMENT_PROVIDER = String(import.meta.env.VITE_PAYMENT_PROVIDER || '').trim().toLowerCase();

const buildDirectBuyItem = (directBuy) => {
    if (!directBuy?.product) return null;
    return {
        ...directBuy.product,
        id: directBuy.product.id,
        quantity: Number(directBuy.quantity) || 1,
    };
};

const isPhoneValid = (phone) => /^\+?\d[\d\s-]{8,15}$/.test(String(phone || '').trim());

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
    const itemsPrice = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0);
    return {
        itemsPrice,
        totalPrice: itemsPrice,
    };
};

const getQuotePayload = ({ checkoutItems, draft }) => ({
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
    checkoutSource: draft.checkoutSource,
});

const Checkout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { cartItems, clearCart } = useContext(CartContext);
    const { currentUser, syncUserWithBackend } = useContext(AuthContext);

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
        paymentSimulation: EMPTY_SIMULATION,
        paymentIntent: EMPTY_INTENT,
        couponCode: '',
        acceptedTerms: false,
    }), []);

    const { draft, setDraft, clearDraft, isHydrated } = useCheckoutDraft(currentUser?.uid, defaultDraft);

    const [savedAddresses, setSavedAddresses] = useState([]);
    const [isLoadingProfile, setIsLoadingProfile] = useState(true);
    const [isSavingAddress, setIsSavingAddress] = useState(false);
    const [isDetectingAddressGps, setIsDetectingAddressGps] = useState(false);
    const [addressGpsHint, setAddressGpsHint] = useState('');
    const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
    const [stepErrors, setStepErrors] = useState({
        address: '',
        delivery: '',
        payment: '',
        review: '',
    });

    const [quote, setQuote] = useState(null);
    const [isQuoting, setIsQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState('');
    const [lastQuoteSignature, setLastQuoteSignature] = useState('');
    const [lastQuoteAt, setLastQuoteAt] = useState(0);
    const [isPlacingOrder, setIsPlacingOrder] = useState(false);
    const [isSimulatingPayment, setIsSimulatingPayment] = useState(false);

    const directBuyFromLocation = useMemo(
        () => buildDirectBuyItem(location.state?.directBuy),
        [location.state]
    );

    useEffect(() => {
        if (!directBuyFromLocation) return;
        setDraft((prev) => ({
            ...prev,
            checkoutSource: 'directBuy',
            directBuyItem: directBuyFromLocation,
        }));
    }, [directBuyFromLocation, setDraft]);

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
                const profile = await userApi.getProfile(currentUser.email);
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

                const recoveredProfile = await userApi.getProfile(currentUser.email);
                if (!isMounted) return;
                applyProfile(recoveredProfile);
            }
        };

        hydrateProfile()
            .catch((error) => {
                if (isMounted) {
                    toast.error(error.message || 'Failed to load profile for checkout');
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
        paymentApi.getMethods()
            .then((methods) => {
                setSavedPaymentMethods(methods || []);
                setDraft((prev) => {
                    if (prev.selectedSavedMethodId) return prev;
                    const defaultMethod = (methods || []).find((method) => method.isDefault) || (methods || [])[0];
                    return {
                        ...prev,
                        selectedSavedMethodId: defaultMethod?._id || '',
                    };
                });
            })
            .catch(() => {
                setSavedPaymentMethods([]);
            });
    }, [currentUser?.uid, setDraft]);

    const checkoutItems = useMemo(() => {
        if (draft.checkoutSource === 'directBuy' && draft.directBuyItem) {
            return [draft.directBuyItem];
        }
        return cartItems;
    }, [cartItems, draft.checkoutSource, draft.directBuyItem]);

    const fallbackTotals = useMemo(() => getFallbackTotals(checkoutItems), [checkoutItems]);

    const canQuote = useMemo(
        () => checkoutItems.length > 0 && isAddressValid(draft.shippingAddress),
        [checkoutItems.length, draft.shippingAddress]
    );

    const quotePayload = useMemo(
        () => getQuotePayload({ checkoutItems, draft }),
        [checkoutItems, draft]
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
            setQuoteError(error.message || 'Unable to fetch live pricing');
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
                Number.isFinite(detected.confidence) ? `confidence ${detected.confidence}%` : '',
                Number.isFinite(detected.accuracy) && detected.accuracy > 0 ? `${Math.round(detected.accuracy)}m accuracy` : '',
            ].filter(Boolean);
            setAddressGpsHint(
                `${locationParts.length ? `Detected ${locationParts.join(', ')}` : 'Detected location'}${
                    qualityParts.length ? ` (${qualityParts.join(', ')})` : ''
                }`
            );
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || 'Unable to detect your location' }));
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
            toast.success('Address saved');
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || 'Unable to save address' }));
        } finally {
            setIsSavingAddress(false);
        }
    };

    const updateSelectedAddress = async () => {
        if (!draft.selectedAddressId) {
            setStepErrors((prev) => ({ ...prev, address: 'Select a saved address before updating' }));
            return;
        }

        try {
            setIsSavingAddress(true);
            const payload = getAddressPayloadFromDraft();
            const response = await userApi.updateAddress(draft.selectedAddressId, payload);
            setSavedAddresses(response.addresses || []);
            toast.success('Address updated');
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, address: error.message || 'Unable to update address' }));
        } finally {
            setIsSavingAddress(false);
        }
    };

    const validateAddressStep = () => {
        if (!draft.contact.name.trim()) return 'Contact name is required';
        if (!isPhoneValid(draft.contact.phone)) return 'Enter a valid phone number';
        if (!isAddressValid(draft.shippingAddress)) return 'Complete shipping address is required';
        return '';
    };

    const validateDeliveryStep = () => {
        if (!draft.deliverySlot.date) return 'Select a delivery date';
        if (!draft.deliverySlot.window) return 'Select a delivery window';
        return '';
    };

    const validatePaymentStep = () => {
        if (!draft.paymentMethod) return 'Choose a payment method';
        if (draft.paymentMethod !== 'COD' && draft.paymentSimulation.status !== 'success') {
            return 'Complete digital payment simulation before continuing';
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
            paymentSimulation: EMPTY_SIMULATION,
            paymentIntent: EMPTY_INTENT,
        }));
        setStepErrors((prev) => ({ ...prev, payment: '' }));
    };

    const simulateDigitalPayment = async () => {
        if (draft.paymentMethod === 'COD') return;
        try {
            setIsSimulatingPayment(true);
            setStepErrors((prev) => ({ ...prev, payment: '' }));
            const amount = quote?.totalPrice || fallbackTotals.totalPrice;
            const quoteSnapshot = {
                totalPrice: amount,
                pricingVersion: quote?.pricingVersion || 'v2',
            };

            const useSimulatedFlow = PAYMENT_PROVIDER === 'simulated';
            if (useSimulatedFlow) {
                const attemptToken = `${currentUser.uid}-${Date.now()}`;
                const response = await orderApi.simulatePayment({
                    paymentMethod: draft.paymentMethod,
                    amount,
                    attemptToken,
                });
                setDraft((prev) => ({
                    ...prev,
                    paymentSimulation: {
                        ...response,
                        attemptToken,
                    },
                    paymentIntent: {
                        ...EMPTY_INTENT,
                        status: response.status,
                    },
                }));

                if (response.status === 'success') {
                    toast.success('Payment simulation successful');
                } else if (response.status === 'pending') {
                    toast.warning('Payment is pending. Retry or fallback to COD.');
                } else {
                    toast.error('Payment simulation failed. Retry or fallback to COD.');
                }
                return;
            }

            const intent = await paymentApi.createIntent({
                quotePayload,
                quoteSnapshot,
                paymentMethod: draft.paymentMethod,
                savedMethodId: draft.selectedSavedMethodId || undefined,
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
                    status: intent.status,
                    riskDecision: intent.riskDecision,
                    challengeRequired: Boolean(intent.challengeRequired),
                    challengeVerified: false,
                    checkoutPayload: intent.checkoutPayload || null,
                },
                paymentSimulation: EMPTY_SIMULATION,
            }));

            if (intent.challengeRequired) {
                toast.warning('Additional OTP verification is required before payment confirmation');
                return;
            }

            await loadRazorpayScript();
            await new Promise((resolve, reject) => {
                const rzp = new window.Razorpay({
                    ...intent.checkoutPayload,
                    handler: async (paymentResponse) => {
                        try {
                            const confirmResult = await paymentApi.confirmIntent(intent.intentId, {
                                providerPaymentId: paymentResponse.razorpay_payment_id,
                                providerOrderId: paymentResponse.razorpay_order_id,
                                providerSignature: paymentResponse.razorpay_signature,
                            });
                            setDraft((prev) => ({
                                ...prev,
                                paymentIntent: {
                                    ...prev.paymentIntent,
                                    status: confirmResult.status,
                                },
                                paymentSimulation: {
                                    status: 'success',
                                    message: 'Payment authorized successfully',
                                    referenceId: paymentResponse.razorpay_payment_id,
                                    attemptToken: `${intent.intentId}-confirm`,
                                },
                            }));
                            toast.success('Payment authorized successfully');
                            resolve();
                        } catch (confirmError) {
                            reject(confirmError);
                        }
                    },
                    modal: {
                        ondismiss: () => reject(new Error('Payment window closed before completion')),
                    },
                });
                rzp.open();
            });
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, payment: error.message || 'Payment simulation failed' }));
        } finally {
            setIsSimulatingPayment(false);
        }
    };

    const sendPaymentChallengeOtp = async () => {
        if (!draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, payment: 'Create payment intent first' }));
            return;
        }
        try {
            setIsSimulatingPayment(true);
            await otpApi.sendOtp(draft.contact.email, draft.contact.phone, 'payment-challenge');
            toast.success('Payment challenge OTP sent');
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, payment: error.message || 'Failed to send challenge OTP' }));
        } finally {
            setIsSimulatingPayment(false);
        }
    };

    const markPaymentChallengeComplete = async () => {
        if (!draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, payment: 'Create payment intent first' }));
            return;
        }

        const otp = window.prompt('Enter payment challenge OTP');
        if (!otp) return;

        try {
            setIsSimulatingPayment(true);
            const otpResult = await otpApi.verifyOtp(
                draft.contact.phone,
                String(otp),
                'payment-challenge',
                draft.paymentIntent.intentId
            );
            if (!otpResult?.challengeToken) {
                throw new Error('Challenge token missing after OTP verification');
            }
            await paymentApi.completeChallenge(draft.paymentIntent.intentId, {
                challengeToken: otpResult.challengeToken,
            });

            setDraft((prev) => ({
                ...prev,
                paymentIntent: {
                    ...prev.paymentIntent,
                    challengeVerified: true,
                    challengeRequired: true,
                    status: 'created',
                },
            }));
            toast.success('Challenge verification complete. Run secure payment now.');
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, payment: error.message || 'Payment challenge verification failed' }));
        } finally {
            setIsSimulatingPayment(false);
        }
    };

    const fallbackToCod = () => {
        setDraft((prev) => ({
            ...prev,
            paymentMethod: 'COD',
            paymentSimulation: EMPTY_SIMULATION,
            paymentIntent: EMPTY_INTENT,
        }));
        toast.info('Switched to Cash on Delivery');
    };

    const applyCoupon = async () => {
        if (!draft.couponCode.trim()) {
            setStepErrors((prev) => ({ ...prev, review: 'Enter a coupon code first' }));
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
            setStepErrors((prev) => ({ ...prev, review: 'Accept the checkout terms before placing order' }));
            return;
        }
        if (isQuoteStale) {
            setStepErrors((prev) => ({ ...prev, review: 'Quote is stale. Recalculate before placing order.' }));
            return;
        }
        if (draft.paymentMethod !== 'COD' && draft.paymentSimulation.status !== 'success') {
            setStepErrors((prev) => ({ ...prev, review: 'Digital payment is not confirmed yet.' }));
            return;
        }
        if (draft.paymentMethod !== 'COD' && PAYMENT_PROVIDER !== 'simulated' && !draft.paymentIntent.intentId) {
            setStepErrors((prev) => ({ ...prev, review: 'Payment intent is missing. Please retry payment.' }));
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
                checkoutSource: draft.checkoutSource,
                paymentIntentId: draft.paymentIntent.intentId || undefined,
                quoteSnapshot: {
                    totalPrice: quote.totalPrice,
                    pricingVersion: quote.pricingVersion || 'v2',
                },
                paymentSimulation: draft.paymentMethod === 'COD'
                    ? undefined
                    : {
                        status: draft.paymentSimulation.status,
                        referenceId: draft.paymentSimulation.referenceId,
                    },
                idempotencyKey: `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            };

            const createdOrder = await orderApi.createOrder(payload);

            if (draft.checkoutSource !== 'directBuy') {
                clearCart();
            }

            clearDraft();
            toast.success('Order placed successfully');
            navigate('/orders', {
                state: { orderPlaced: true, orderId: createdOrder?._id },
            });
        } catch (error) {
            setStepErrors((prev) => ({ ...prev, review: error.message || 'Order placement failed' }));
        } finally {
            setIsPlacingOrder(false);
        }
    };

    if (checkoutItems.length === 0 && !isLoadingProfile) {
        return (
            <div className="min-h-screen py-20 flex items-center justify-center">
                <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 text-center shadow-glass">
                    <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-3">Nothing to checkout</h2>
                    <p className="text-slate-400 mb-8">Your bag is empty right now.</p>
                    <button onClick={() => navigate('/')} className="btn-primary w-full">Continue Shopping</button>
                </div>
            </div>
        );
    }

    if (!isHydrated || isLoadingProfile) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="flex items-center gap-3 text-slate-300">
                    <Loader2 className="w-5 h-5 animate-spin text-neo-cyan" />
                    Preparing checkout...
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-20 relative">
            <div className="absolute top-0 right-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/10 rounded-full blur-[150px] pointer-events-none -z-10" />
            <div className="absolute bottom-20 left-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-fuchsia/10 rounded-full blur-[150px] pointer-events-none -z-10" />

            <div className="bg-zinc-950/80 backdrop-blur-xl border-b border-white/10 sticky top-20 md:top-24 z-40">
                <div className="container-custom min-h-16 sm:min-h-20 py-3 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="text-slate-300 hover:text-white flex items-center gap-2 text-sm uppercase tracking-wider font-bold"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <div className="hidden sm:flex items-center gap-2 text-slate-400 text-xs uppercase tracking-[0.2em] font-bold">
                        <Layers className="w-4 h-4 text-neo-cyan" />
                        Checkout V2
                    </div>
                    <div className="text-xs uppercase tracking-wider font-bold text-slate-400">
                        Step {draft.step} / 4
                    </div>
                </div>
            </div>

            <div className="container-custom py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <StepAddress
                        isActive={draft.step === 1}
                        completed={draft.step > 1}
                        contact={draft.contact}
                        shippingAddress={draft.shippingAddress}
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
                        paymentSimulation={draft.paymentSimulation}
                        isSimulatingPayment={isSimulatingPayment}
                        paymentError={stepErrors.payment}
                        savedMethods={savedPaymentMethods}
                        selectedSavedMethodId={draft.selectedSavedMethodId}
                        onSelectSavedMethod={(methodId) => setDraft((prev) => ({ ...prev, selectedSavedMethodId: methodId }))}
                        challengeRequired={Boolean(draft.paymentIntent.challengeRequired)}
                        challengeVerified={Boolean(draft.paymentIntent.challengeVerified)}
                        onSendChallengeOtp={sendPaymentChallengeOtp}
                        onMarkChallengeComplete={markPaymentChallengeComplete}
                        isChallengeLoading={isSimulatingPayment}
                        useSimulatedFlow={PAYMENT_PROVIDER === 'simulated'}
                        onSetActive={() => draft.step > 2 && gotoStep(3)}
                        onPaymentMethodChange={handlePaymentMethodChange}
                        onSimulatePayment={simulateDigitalPayment}
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

            {isPlacingOrder ? (
                <div className="fixed inset-0 bg-zinc-950/70 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center text-slate-200">
                        <Loader2 className="w-6 h-6 animate-spin text-neo-cyan mx-auto mb-3" />
                        <p className="font-bold uppercase tracking-wider text-sm">Placing your order...</p>
                        <p className="text-xs text-slate-400 mt-1">Validating stock and final pricing</p>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default Checkout;
