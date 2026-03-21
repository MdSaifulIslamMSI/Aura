import { useEffect, useMemo, useRef, useState } from 'react';

const DRAFT_PREFIX = 'aura_checkout_draft_';

const safeParse = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const mergeDraftState = (initialState, storedState) => {
    if (!storedState || typeof storedState !== 'object') return initialState;

    return {
        ...initialState,
        ...storedState,
        contact: {
            ...initialState.contact,
            ...(storedState.contact || {}),
        },
        shippingAddress: {
            ...initialState.shippingAddress,
            ...(storedState.shippingAddress || {}),
        },
        deliverySlot: storedState.deliverySlot || initialState.deliverySlot,
        paymentSimulation: {
            ...initialState.paymentSimulation,
            ...(storedState.paymentSimulation || {}),
        },
        paymentIntent: {
            ...(initialState.paymentIntent || {}),
            ...((storedState.paymentIntent || {})),
        },
    };
};

const buildDraftKey = ({ userId, checkoutSource = 'cart', cartRevision = 'guest' } = {}) => (
    `${DRAFT_PREFIX}${userId}_${checkoutSource}_${cartRevision}`
);

const useCheckoutDraft = (userId, initialState, options = {}) => {
    const checkoutSource = options?.checkoutSource || 'cart';
    const cartRevision = options?.cartRevision ?? 'guest';
    const storageKey = useMemo(() => {
        if (!userId) return null;
        return buildDraftKey({ userId, checkoutSource, cartRevision });
    }, [cartRevision, checkoutSource, userId]);

    const [draft, setDraft] = useState(initialState);
    const [isHydrated, setIsHydrated] = useState(false);
    const skipNextPersistRef = useRef(false);

    useEffect(() => {
        if (!storageKey) {
            setDraft(initialState);
            setIsHydrated(true);
            return;
        }

        const legacyKey = `${DRAFT_PREFIX}${userId}`;
        const storedValue = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
        const storedState = safeParse(storedValue);
        setDraft(mergeDraftState(initialState, storedState));
        setIsHydrated(true);
    }, [initialState, storageKey, userId]);

    useEffect(() => {
        if (!storageKey || !isHydrated) return;
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }
        localStorage.setItem(storageKey, JSON.stringify(draft));
    }, [draft, isHydrated, storageKey]);

    const clearDraft = () => {
        skipNextPersistRef.current = true;
        if (storageKey) localStorage.removeItem(storageKey);
        setDraft(initialState);
    };

    return {
        draft,
        setDraft,
        clearDraft,
        isHydrated,
    };
};

export default useCheckoutDraft;
