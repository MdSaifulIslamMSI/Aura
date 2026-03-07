/**
 * Centralized auth error/success message system.
 * Maps raw error strings (from backend or Firebase) to human-friendly,
 * actionable UI messages with title, detail, icon, and next-step suggestion.
 */

// ── Error Definitions ──────────────────────────────────────────────────────
export const AUTH_ERRORS = {
    // ── Firebase / Password errors
    'auth/wrong-password': {
        title: 'Wrong Password',
        detail: 'The password you entered doesn\'t match our records.',
        hint: 'Double-check CAPS LOCK, or click "Forgot Password?" to reset it.',
        action: 'forgot-password',
        actionLabel: 'Reset my password'
    },
    'auth/invalid-credential': {
        title: 'Invalid Credentials',
        detail: 'Email or password is incorrect.',
        hint: 'Make sure you\'re using the email you registered with. Try "Forgot Password?" if you\'re stuck.',
        action: 'forgot-password',
        actionLabel: 'Reset my password'
    },
    'auth/user-not-found': {
        title: 'Account Not Found',
        detail: 'No account exists with this email address.',
        hint: 'Try a different email, or create a new AURA account.',
        action: 'signup',
        actionLabel: 'Create an account'
    },
    'auth/email-already-in-use': {
        title: 'Email Already Registered',
        detail: 'An account already exists with this email.',
        hint: 'Sign in instead, or use "Forgot Password?" if you\'ve lost access.',
        action: 'signin',
        actionLabel: 'Sign in instead'
    },
    'auth/too-many-requests': {
        title: 'Too Many Attempts',
        detail: 'Your account has been temporarily locked due to too many failed sign-in attempts.',
        hint: 'Wait a few minutes and try again, or reset your password to regain access immediately.',
        action: 'forgot-password',
        actionLabel: 'Reset & unlock my account'
    },
    'auth/network-request-failed': {
        title: 'Connection Problem',
        detail: 'We couldn\'t reach our authentication servers.',
        hint: 'Check your internet connection and try again.',
        action: null,
        actionLabel: null
    },
    'auth/popup-closed-by-user': {
        title: 'Sign-In Cancelled',
        detail: 'The Google sign-in window was closed before completing.',
        hint: 'Click "Continue with Google" again to try.',
        action: null,
        actionLabel: null
    },
    'auth/unauthorized-domain': {
        title: 'Domain Not Authorized',
        detail: 'This app URL is not allowed in Firebase Authentication.',
        hint: 'Open the app on localhost (not 127.0.0.1), and add both domains in Firebase Authorized Domains.',
        action: null,
        actionLabel: null
    },
    'auth/configuration-unavailable': {
        title: 'Authentication Not Configured',
        detail: 'Firebase authentication is not configured correctly for this deployment.',
        hint: 'The site can still load, but sign-in features will stay unavailable until the Firebase web config is fixed.',
        action: null,
        actionLabel: null
    },
    'auth/invalid-api-key': {
        title: 'Authentication Misconfigured',
        detail: 'The deployed Firebase API key is invalid for this frontend.',
        hint: 'Fix the Firebase web app configuration for this deployed domain, then redeploy the frontend.',
        action: null,
        actionLabel: null
    },

    // ── OTP / Backend errors (matched by message content)
    'no account found with this phone': {
        title: 'Phone Not Registered',
        detail: 'We couldn\'t find an account linked to this phone number.',
        hint: 'Make sure you\'re using the phone you signed up with, or create a new account.',
        action: 'signup',
        actionLabel: 'Sign up instead'
    },
    'no account found with this email': {
        title: 'Email Not Registered',
        detail: 'We couldn\'t find an account linked to this email.',
        hint: 'Try a different email address, or create a new account for free.',
        action: 'signup',
        actionLabel: 'Create a new account'
    },
    'no account found': {
        title: 'Account Not Found',
        detail: 'No registered account matches your phone or email.',
        hint: 'Are you sure you have an account? You can sign up — it\'s free.',
        action: 'signup',
        actionLabel: 'Create my account'
    },
    'account with this email already exists': {
        title: 'Email Already Registered',
        detail: 'An account already exists with this email address.',
        hint: 'Sign in to your existing account instead.',
        action: 'signin',
        actionLabel: 'Sign in to my account'
    },
    'account with this phone number already exists': {
        title: 'Phone Already Registered',
        detail: 'An account with this phone number already exists.',
        hint: 'Sign in using the email associated with this phone number.',
        action: 'signin',
        actionLabel: 'Sign in to my account'
    },
    'invalid otp': {
        title: 'Incorrect Code',
        detail: 'The 6-digit code you entered doesn\'t match what we sent.',
        hint: 'Check the email we sent — the code is exactly 6 digits. No spaces.',
        action: null,
        actionLabel: null
    },
    'otp has expired': {
        title: 'Code Expired',
        detail: 'Your verification code has expired (codes are valid for 5 minutes).',
        hint: 'Click "Resend OTP" below to get a fresh code.',
        action: 'resend',
        actionLabel: 'Send a new code'
    },
    'otp purpose mismatch': {
        title: 'Session Mismatch',
        detail: 'Something went wrong with your verification session.',
        hint: 'Go back and start the process again from the beginning.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'phone number is required': {
        title: 'Phone Number Missing',
        detail: 'Please enter your registered phone number.',
        hint: 'Include the country code, e.g. +91 98765 43210',
        action: null,
        actionLabel: null
    },
    'enter complete 6-digit otp': {
        title: 'Incomplete Code',
        detail: 'Please fill in all 6 digits of your verification code.',
        hint: 'Check your email inbox for the code. Look in your Spam folder too!',
        action: null,
        actionLabel: null
    },
    'too many failed attempts': {
        title: 'Account Temporarily Locked',
        detail: 'Too many failed attempts. Security lock is now active.',
        hint: 'Wait 15 minutes, or reset your password to unlock immediately.',
        action: 'forgot-password',
        actionLabel: 'Reset password to unlock'
    },
    // ── Validation
    'password must be at least 6': {
        title: 'Password Too Short',
        detail: 'Your password must be at least 6 characters long.',
        hint: 'Use a mix of letters, numbers, and symbols for a strong password.',
        action: null,
        actionLabel: null
    },
    'passwords do not match': {
        title: 'Passwords Don\'t Match',
        detail: 'Your password and confirmation don\'t match.',
        hint: 'Re-type your password carefully in both fields.',
        action: null,
        actionLabel: null
    },
    'valid phone number is required': {
        title: 'Invalid Phone Number',
        detail: 'Please enter a valid phone number (10–15 digits).',
        hint: 'Include the country code, e.g. +91 98765 43210',
        action: null,
        actionLabel: null
    },
    'google sign-in failed': {
        title: 'Google Sign-In Failed',
        detail: 'We couldn\'t complete Google authentication.',
        hint: 'Try again, or sign in manually with your email and password.',
        action: null,
        actionLabel: null
    },
    'failed to send otp': {
        title: 'Couldn\'t Send Code',
        detail: 'We had trouble sending your verification code.',
        hint: 'Check your email address is correct and try again.',
        action: null,
        actionLabel: null
    },
    'temporarily suspended until': {
        title: 'Account Suspended',
        detail: 'Your account is currently suspended by the trust and safety team.',
        hint: 'Please contact support to request a review.',
        action: null,
        actionLabel: null
    },
    'your account is not active': {
        title: 'Account Disabled',
        detail: 'This account is no longer active.',
        hint: 'Contact support for account recovery options.',
        action: null,
        actionLabel: null
    },
    'user profile missing from login database': {
        title: 'Session Recovery Required',
        detail: 'Your profile needs to be re-synced before continuing.',
        hint: 'Sign out and sign in again to recover your account session.',
        action: 'signin',
        actionLabel: 'Sign in again'
    },
    'default': {
        title: 'Something Went Wrong',
        detail: 'An unexpected error occurred during sign-in.',
        hint: 'Please try again. If this continues, contact support.',
        action: null,
        actionLabel: null
    }
};

/**
 * Resolve a raw error (code or message string) into a structured AUTH_ERROR object.
 * @param {string} rawError — Firebase error code OR backend message string
 * @returns {object} — { title, detail, hint, action, actionLabel }
 */
export const resolveAuthError = (rawError) => {
    if (!rawError) return AUTH_ERRORS['default'];

    const errorStr = (rawError.code || rawError.message || rawError || '').toLowerCase();

    // Try exact Firebase code match first
    if (rawError.code && AUTH_ERRORS[rawError.code]) {
        return AUTH_ERRORS[rawError.code];
    }

    // Try substring match against message
    for (const [key, value] of Object.entries(AUTH_ERRORS)) {
        if (key === 'default') continue;
        if (errorStr.includes(key)) return value;
    }

    return { ...AUTH_ERRORS['default'], detail: rawError.message || rawError };
};

/**
 * Human-friendly SUCCESS messages for each auth action.
 */
export const AUTH_SUCCESS = {
    otp_sent: {
        title: 'Code Sent!',
        detail: 'A 6-digit verification code has been sent to your email.'
    },
    otp_resent: {
        title: 'New Code Sent!',
        detail: 'A fresh code has been sent. Check your inbox (or Spam folder).'
    },
    otp_verified: {
        title: 'Verified!',
        detail: 'Your identity has been confirmed.'
    },
    signin_success: {
        title: 'Welcome Back!',
        detail: 'You\'re now signed in. Redirecting...'
    },
    signup_success: {
        title: 'Account Created!',
        detail: 'Welcome to AURA! Setting up your account...'
    },
    reset_sent: {
        title: 'Reset Email Sent!',
        detail: 'Check your inbox for a password reset link.'
    }
};
