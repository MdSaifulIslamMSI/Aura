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

const useCheckoutDraft = (userId, initialState) => {
    const storageKey = useMemo(() => {
        if (!userId) return null;
        return `${DRAFT_PREFIX}${userId}`;
    }, [userId]);

    const [draft, setDraft] = useState(initialState);
    const [isHydrated, setIsHydrated] = useState(false);
    const skipNextPersistRef = useRef(false);

    useEffect(() => {
        if (!storageKey) {
            setDraft(initialState);
            setIsHydrated(true);
            return;
        }

        const storedValue = localStorage.getItem(storageKey);
        const storedState = safeParse(storedValue);
        setDraft(mergeDraftState(initialState, storedState));
        setIsHydrated(true);
    }, [storageKey, initialState]);

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
