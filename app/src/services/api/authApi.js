import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';
import { ensureCsrfToken, addCsrfTokenToHeaders } from '../csrfTokenManager';

export const authApi = {
    getSession: async (options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const response = await apiFetch('/auth/session', { headers });
        
        // Extract and cache CSRF token from response
        const csrfToken = response.response?.headers?.get('X-CSRF-Token');
        if (csrfToken && typeof cacheToken === 'function') {
            try {
                cacheToken(csrfToken);
            } catch (e) {
                console.warn('Failed to cache CSRF token:', e.message);
            }
        }
        
        return response.data;
    },
    syncSession: async (email, name, phone, options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const firebaseUser = options.firebaseUser || {};
        const authToken = options.authToken || (firebaseUser.getIdToken ? await firebaseUser.getIdToken() : '');
        
        // Ensure CSRF token is available for POST request
        let csrfToken = null;
        try {
            if (authToken) {
                csrfToken = await ensureCsrfToken(authToken);
            }
        } catch (error) {
            throw new Error(`CSRF token fetch failed for syncSession: ${error.message}. Please refresh and try again.`);
        }

        const headersWithCsrf = addCsrfTokenToHeaders(headers, 'POST', csrfToken);
        
        const { data } = await apiFetch('/auth/sync', {
            method: 'POST',
            headers: headersWithCsrf,
            body: JSON.stringify({ email, name, phone }),
        });
        return data;
    },
    verifyLatticeChallenge: async (challengeId, proof, options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const firebaseUser = options.firebaseUser || {};
        const authToken = options.authToken || (firebaseUser.getIdToken ? await firebaseUser.getIdToken() : '');
        
        // Ensure CSRF token is available for POST request
        let csrfToken = null;
        try {
            if (authToken) {
                csrfToken = await ensureCsrfToken(authToken);
            }
        } catch (error) {
            throw new Error(`CSRF token fetch failed for verifyLatticeChallenge: ${error.message}. Please refresh and try again.`);
        }

        const headersWithCsrf = addCsrfTokenToHeaders(headers, 'POST', csrfToken);
        
        const { data } = await apiFetch('/auth/verify-lattice', {
            method: 'POST',
            headers: headersWithCsrf,
            body: JSON.stringify({ challengeId, proof }),
        });
        return data;
    },
    verifyQuantumChallenge: async (challengeId, proof, options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const firebaseUser = options.firebaseUser || {};
        const authToken = options.authToken || (firebaseUser.getIdToken ? await firebaseUser.getIdToken() : '');
        
        // Ensure CSRF token is available for POST request
        let csrfToken = null;
        try {
            if (authToken) {
                csrfToken = await ensureCsrfToken(authToken);
            }
        } catch (error) {
            throw new Error(`CSRF token fetch failed for verifyQuantumChallenge: ${error.message}. Please refresh and try again.`);
        }

        const headersWithCsrf = addCsrfTokenToHeaders(headers, 'POST', csrfToken);
        
        const { data } = await apiFetch('/auth/verify-quantum', {
            method: 'POST',
            headers: headersWithCsrf,
            body: JSON.stringify({ challengeId, proof }),
        });
        return data;
    }
};


export const otpApi = {
    sendOtp: async (email, phone, purpose, options = {}) => {
        const { data } = await apiFetch('/auth/otp/send', {
            method: 'POST',
            body: JSON.stringify({ email, phone, purpose, ...options }),
        });
        return data;
    },
    verifyOtp: async (phone, otp, purpose, intentId = '') => {
        const { data } = await apiFetch('/auth/otp/verify', {
            method: 'POST',
            body: JSON.stringify({ phone, otp, purpose, intentId }),
        });
        return data;
    },
    checkUserExists: async (phone, email = '') => {
        const { data } = await apiFetch('/auth/otp/check-user', {
            method: 'POST',
            body: JSON.stringify({ phone, email }),
        });
        return data;
    }
};
