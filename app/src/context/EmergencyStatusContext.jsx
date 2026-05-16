import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { emergencyApi } from '@/services/api';

const POLL_INTERVAL_MS = 45 * 1000;

const EMPTY_STATUS = {
    maintenance: false,
    readOnly: false,
    disabledFeatures: [],
    bannerMessage: '',
    timestamp: '',
};

const EmergencyStatusContext = createContext({
    ...EMPTY_STATUS,
    loading: false,
    error: null,
    isFeatureDisabled: () => false,
    refreshEmergencyStatus: async () => EMPTY_STATUS,
});

const normalizeStatus = (value = {}) => ({
    maintenance: Boolean(value?.maintenance),
    readOnly: Boolean(value?.readOnly),
    disabledFeatures: Array.isArray(value?.disabledFeatures)
        ? value.disabledFeatures.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    bannerMessage: String(value?.bannerMessage || ''),
    timestamp: String(value?.timestamp || ''),
});

export const EmergencyStatusProvider = ({ children }) => {
    const [status, setStatus] = useState(EMPTY_STATUS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const inflightRef = useRef(null);
    const statusRef = useRef(EMPTY_STATUS);

    const refreshEmergencyStatus = useCallback(async () => {
        if (inflightRef.current) {
            return inflightRef.current;
        }

        const request = emergencyApi.getStatus()
            .then((payload) => {
                const normalized = normalizeStatus(payload);
                statusRef.current = normalized;
                setStatus(normalized);
                setError(null);
                return normalized;
            })
            .catch((nextError) => {
                setError(nextError);
                return statusRef.current;
            })
            .finally(() => {
                setLoading(false);
                inflightRef.current = null;
            });

        inflightRef.current = request;
        return request;
    }, []);

    useEffect(() => {
        void refreshEmergencyStatus();
        const intervalId = window.setInterval(() => {
            void refreshEmergencyStatus();
        }, POLL_INTERVAL_MS);

        const handleFocus = () => {
            void refreshEmergencyStatus();
        };
        const handleEmergencyRefresh = () => {
            void refreshEmergencyStatus();
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('aura:emergency-status:refresh', handleEmergencyRefresh);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('aura:emergency-status:refresh', handleEmergencyRefresh);
        };
    }, [refreshEmergencyStatus]);

    const value = useMemo(() => {
        const disabled = new Set(status.disabledFeatures);
        return {
            ...status,
            loading,
            error,
            isFeatureDisabled: (feature) => disabled.has(String(feature || '').trim()),
            refreshEmergencyStatus,
        };
    }, [error, loading, refreshEmergencyStatus, status]);

    return (
        <EmergencyStatusContext.Provider value={value}>
            {children}
        </EmergencyStatusContext.Provider>
    );
};

export const useEmergencyStatus = () => useContext(EmergencyStatusContext);
