import { useCallback, useEffect, useRef, useState } from 'react';

const resolveSpeechRecognition = () => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const useSpeechInput = ({
    value = '',
    onChange,
    lang = 'en-IN',
    clearOnStart = false,
    interimResults = true,
    continuous = false,
} = {}) => {
    const recognitionRef = useRef(null);
    const valueRef = useRef(String(value || ''));
    const sessionPrefixRef = useRef('');

    const [isListening, setIsListening] = useState(false);
    const [supportsSpeechInput, setSupportsSpeechInput] = useState(false);

    useEffect(() => {
        valueRef.current = String(value || '');
    }, [value]);

    useEffect(() => {
        const SpeechRecognition = resolveSpeechRecognition();
        if (!SpeechRecognition) {
            setSupportsSpeechInput(false);
            recognitionRef.current = null;
            return undefined;
        }

        setSupportsSpeechInput(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = Boolean(continuous);
        recognition.interimResults = Boolean(interimResults);
        recognition.lang = lang;

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map((result) => result[0]?.transcript || '')
                .join('')
                .trim();

            const prefix = sessionPrefixRef.current;
            const nextValue = transcript
                ? [prefix, transcript].filter(Boolean).join(prefix ? ' ' : '')
                : prefix;

            onChange?.(nextValue);
        };

        recognition.onerror = () => {
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;

            try {
                recognition.stop();
            } catch {
                // Ignore duplicate stop attempts during teardown.
            }

            recognitionRef.current = null;
        };
    }, [continuous, interimResults, lang, onChange]);

    const stopListening = useCallback(() => {
        const recognition = recognitionRef.current;
        if (!recognition) {
            return false;
        }

        try {
            recognition.stop();
        } catch {
            // Ignore browsers that throw when stop is called after ending.
        }

        setIsListening(false);
        return true;
    }, []);

    const startListening = useCallback(() => {
        const recognition = recognitionRef.current;
        if (!recognition) {
            return false;
        }

        sessionPrefixRef.current = clearOnStart
            ? ''
            : String(valueRef.current || '').trim();

        if (clearOnStart) {
            onChange?.('');
        }

        try {
            recognition.lang = lang;
            recognition.start();
            setIsListening(true);
            return true;
        } catch {
            setIsListening(false);
            return false;
        }
    }, [clearOnStart, lang, onChange]);

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
            return false;
        }

        return startListening();
    }, [isListening, startListening, stopListening]);

    return {
        isListening,
        supportsSpeechInput,
        recognitionRef,
        startListening,
        stopListening,
        toggleListening,
    };
};

export default useSpeechInput;
