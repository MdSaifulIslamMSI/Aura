import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider, TwitterAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

const sanitizeFirebaseValue = (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(/[\r\n\t]+/g, '').trim();
};

const sanitizeHostValue = (value) => {
    const normalized = sanitizeFirebaseValue(value);
    if (!normalized) return normalized;

    try {
        const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
        return url.hostname.trim();
    } catch {
        return normalized
            .replace(/^https?:\/\//i, '')
            .replace(/\/.*$/, '')
            .trim();
    }
};

const parseBooleanEnv = (value, fallback = false) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

export const firebaseConfig = {
    apiKey: sanitizeFirebaseValue(import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: sanitizeHostValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: sanitizeFirebaseValue(import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: sanitizeHostValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: sanitizeFirebaseValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: sanitizeFirebaseValue(import.meta.env.VITE_FIREBASE_APP_ID),
    measurementId: sanitizeFirebaseValue(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID)
};

const requiredConfigKeys = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
];

const hasRequiredConfig = requiredConfigKeys.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === 'string' && value.trim().length > 0;
});

const buildFirebaseConfigError = (message) => {
    const error = new Error(message);
    error.code = 'auth/configuration-unavailable';
    return error;
};

let app = null;
let auth = null;
let googleProvider = null;
let facebookProvider = null;
let xProvider = null;
let analytics = null;
let firebaseInitError = null;

const runtimeHost = typeof window !== 'undefined'
    ? sanitizeHostValue(window.location.hostname || window.location.host)
    : '';
const disableSocialAuth = parseBooleanEnv(import.meta.env.VITE_FIREBASE_DISABLE_SOCIAL_AUTH, false);
const isDeploymentHost = typeof runtimeHost === 'string' && runtimeHost.endsWith('.vercel.app');

if (!hasRequiredConfig) {
    firebaseInitError = buildFirebaseConfigError('Firebase configuration is missing required values.');
} else {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);

        googleProvider = new GoogleAuthProvider();
        facebookProvider = new FacebookAuthProvider();
        xProvider = new TwitterAuthProvider();

        facebookProvider.setCustomParameters({
            display: 'popup',
        });

        if (typeof window !== 'undefined') {
            try {
                analytics = getAnalytics(app);
            } catch {
                analytics = null;
            }
        }
    } catch (error) {
        firebaseInitError = error;
        app = null;
        auth = null;
        googleProvider = null;
        facebookProvider = null;
        xProvider = null;
        analytics = null;
    }
}

export const isFirebaseReady = Boolean(app && auth);
export const isFirebaseSocialAuthAvailable = Boolean(
    isFirebaseReady && (!disableSocialAuth || isDeploymentHost)
);
export const getFirebaseSocialAuthStatus = () => ({
    ready: isFirebaseReady,
    supported: isFirebaseSocialAuthAvailable,
    runtimeHost,
    disabledByConfig: disableSocialAuth && !isDeploymentHost,
    initErrorCode: firebaseInitError?.code || '',
    initErrorMessage: firebaseInitError?.message || '',
});
export const getFirebaseInitError = () => firebaseInitError;
export const assertFirebaseReady = (feature = 'Firebase authentication') => {
    if (isFirebaseReady) return;

    if (firebaseInitError) {
        throw firebaseInitError;
    }

    throw buildFirebaseConfigError(`${feature} is not configured.`);
};

export const assertFirebaseSocialAuthReady = (feature = 'Social sign-in') => {
    assertFirebaseReady(feature);

    if (isFirebaseSocialAuthAvailable) return;

    const error = buildFirebaseConfigError(`${feature} is disabled by deployment configuration.`);
    error.code = 'auth/social-auth-disabled';
    error.host = runtimeHost;
    throw error;
};

export { app, auth, googleProvider, facebookProvider, xProvider, analytics };

export default app;
