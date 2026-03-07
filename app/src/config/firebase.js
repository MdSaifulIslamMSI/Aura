import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider, TwitterAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
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
export const getFirebaseInitError = () => firebaseInitError;
export const assertFirebaseReady = (feature = 'Firebase authentication') => {
    if (isFirebaseReady) return;

    if (firebaseInitError) {
        throw firebaseInitError;
    }

    throw buildFirebaseConfigError(`${feature} is not configured.`);
};

export { app, auth, googleProvider, facebookProvider, xProvider, analytics };

export default app;
