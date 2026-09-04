import { useCallback, useEffect, useRef, useState } from 'react';

export function useAccountNotice() {
    const [message, setMessage] = useState({ type: '', text: '' });
    const messageTimerRef = useRef(null);

    useEffect(() => () => {
        if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    }, []);

    const showMsg = useCallback((type, text) => {
        setMessage({ type, text });
        if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
        if (!text) return;
        messageTimerRef.current = window.setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    }, []);

    return { message, showMsg };
}
