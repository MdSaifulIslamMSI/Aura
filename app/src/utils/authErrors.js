/**
 * Centralized auth error/success message system.
 * Maps raw error strings (from backend or Firebase) to human-friendly,
 * actionable UI messages with title, detail, icon, and next-step suggestion.
 */

// ── Error Definitions ──────────────────────────────────────────────────────
const formatAuthProviderLabel = (provider = '') => {
    const normalized = String(provider || '').trim().toLowerCase();

    switch (normalized) {
        case 'twitter':
        case 'twitter.com':
        case 'x':
        case 'x.com':
            return 'X';
        case 'google':
        case 'google.com':
            return 'Google';
        case 'facebook':
        case 'facebook.com':
            return 'Facebook';
        case 'github':
        case 'github.com':
            return 'GitHub';
        default:
            return provider || 'Social';
    }
};

const resolveErrorProvider = (rawError) => formatAuthProviderLabel(
    rawError?.provider
    || rawError?.providerId
    || rawError?.customData?.providerId
    || ''
);

const buildSocialInvalidCredentialError = (rawError) => {
    const provider = resolveErrorProvider(rawError);

    return {
        title: `${provider} Sign-In Failed`,
        detail: `We couldn't complete ${provider} authentication for this app.`,
        hint: `Re-save the ${provider} provider keys in Firebase, confirm the callback URL uses your Firebase auth handler, and make sure ${provider} can return an email address for this account.`,
        action: null,
        actionLabel: null
    };
};

const buildAccountExistsWithDifferentCredentialError = (rawError) => {
    const provider = resolveErrorProvider(rawError);
    const email = String(rawError?.email || rawError?.customData?.email || '').trim();

    return {
        title: `${provider} Account Already Exists`,
        detail: email
            ? `The email ${email} is already linked to a different sign-in method.`
            : 'This email is already linked to a different sign-in method.',
        hint: `Sign in using the existing provider for this account first, then link ${provider} after login.`,
        action: 'signin',
        actionLabel: 'Sign in with existing method'
    };
};

const buildSocialMissingEmailError = (rawError) => {
    const provider = resolveErrorProvider(rawError);

    return {
        title: `${provider} Email Access Required`,
        detail: `${provider} did not return an email address for this account.`,
        hint: `This app needs an email from ${provider} to attach your profile. Use an account with email access enabled, or continue with email and OTP sign-in.`,
        action: null,
        actionLabel: null
    };
};

const normalizeErrorHost = (value = '') => String(value || '').trim().toLowerCase();

const isIpv4Host = (host = '') => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);

const isIpv6Host = (host = '') => {
    const normalized = normalizeErrorHost(host);
    return Boolean(
        normalized
        && !normalized.includes('.')
        && (normalized.includes(':') || normalized.startsWith('[') || normalized.endsWith(']'))
    );
};

const isIpLiteralHost = (host = '') => isIpv4Host(host) || isIpv6Host(host);

const buildUnauthorizedDomainError = (rawError) => {
    const host = normalizeErrorHost(rawError?.host || '');

    return {
        title: 'Domain Not Authorized',
        detail: 'This app URL is not allowed in Firebase Authentication.',
        hint: isIpLiteralHost(host)
            ? `Authorize ${host} in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Redirect flow can work on that host only after Firebase authorizes it.`
            : 'Add the active site domain in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Email and OTP sign-in remain available immediately.',
        action: null,
        actionLabel: null
    };
};

const buildIllegalIframeError = (rawError) => {
    const host = normalizeErrorHost(rawError?.host || '');

    return {
        title: 'Domain Not Authorized',
        detail: 'Firebase rejected the current site host for popup-based sign-in.',
        hint: isIpLiteralHost(host)
            ? `Authorize ${host} in Firebase Authentication settings, or switch to localhost for local popup testing. Email and OTP sign-in remain available immediately.`
            : 'Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in.',
        action: null,
        actionLabel: null
    };
};

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
        title: 'Unable to Sign In',
        detail: 'We could not verify those account details.',
        hint: 'Check your credentials and try again, or use "Forgot Password?" for help.',
        action: 'forgot-password',
        actionLabel: 'Get sign-in help'
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
        detail: 'The social sign-in window was closed before completing.',
        hint: 'Open the provider window again and complete the sign-in flow.',
        action: null,
        actionLabel: null
    },
    'auth/account-exists-with-different-credential': {
        title: 'Account Already Exists',
        detail: 'This email is already linked to a different sign-in method.',
        hint: 'Sign in with the existing method for this email, then link the new provider later.',
        action: 'signin',
        actionLabel: 'Sign in with existing method'
    },
    'auth/social-invalid-credential': {
        title: 'Social Sign-In Failed',
        detail: 'We could not complete social authentication for this app.',
        hint: 'Check the OAuth provider configuration in Firebase and try again.',
        action: null,
        actionLabel: null
    },
    'auth/social-email-missing': {
        title: 'Social Email Access Required',
        detail: 'The social provider did not return an email address for this account.',
        hint: 'Use a provider account that exposes an email address, or continue with email and OTP sign-in.',
        action: null,
        actionLabel: null
    },
    'auth/unauthorized-domain': {
        title: 'Domain Not Authorized',
        detail: 'This app URL is not allowed in Firebase Authentication.',
        hint: 'Add the active site domain in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Email and OTP sign-in remain available immediately.',
        action: null,
        actionLabel: null
    },
    'illegal url for new iframe': {
        title: 'Domain Not Authorized',
        detail: 'Firebase rejected the current site host for popup-based sign-in.',
        hint: 'Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in.',
        action: null,
        actionLabel: null
    },
    'auth/social-auth-disabled': {
        title: 'Social Sign-In Disabled',
        detail: 'Google, Facebook, and X sign-in are disabled by deployment configuration.',
        hint: 'Use email and OTP sign-in for now, or enable social sign-in in the frontend deployment settings.',
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
    'auth/billing-not-enabled': {
        title: 'Phone Verification Provider Unavailable',
        detail: 'Firebase phone verification is not enabled for this project billing setup.',
        hint: 'Use the secure backup OTP route for now, or enable Firebase billing for phone authentication in the project console.',
        action: null,
        actionLabel: null
    },
    'auth/operation-not-allowed': {
        title: 'Phone Verification Disabled',
        detail: 'Firebase phone authentication is disabled for this project.',
        hint: 'Enable Phone as a Firebase sign-in provider, or continue with the secure backup OTP route.',
        action: null,
        actionLabel: null
    },
    'auth/invalid-app-credential': {
        title: 'Phone Verification Blocked',
        detail: 'Firebase could not initialize the secure phone verification challenge.',
        hint: 'Retry once. If it still fails, the app can fall back to the secure backup OTP path.',
        action: null,
        actionLabel: null
    },
    'auth/missing-app-credential': {
        title: 'Phone Verification Unavailable',
        detail: 'The browser challenge for Firebase phone verification did not complete.',
        hint: 'Retry once, then refresh if the challenge keeps failing.',
        action: null,
        actionLabel: null
    },
    'auth/captcha-check-failed': {
        title: 'Security Check Failed',
        detail: 'The Firebase phone verification challenge did not validate cleanly.',
        hint: 'Retry the challenge and make sure browser protections are not blocking reCAPTCHA.',
        action: null,
        actionLabel: null
    },
    'auth/invalid-verification-code': {
        title: 'Incorrect Code',
        detail: 'That phone verification code is not valid.',
        hint: 'Re-enter the latest 6-digit code, or request a fresh one.',
        action: null,
        actionLabel: null
    },
    'auth/code-expired': {
        title: 'Code Expired',
        detail: 'That phone verification code is no longer valid.',
        hint: 'Request a fresh code and try again.',
        action: 'resend',
        actionLabel: 'Send a new code'
    },
    'auth/quota-exceeded': {
        title: 'Too Many OTP Requests',
        detail: 'Firebase temporarily throttled phone verification requests for this project.',
        hint: 'Wait a bit before retrying, or use the secure backup OTP route if it appears.',
        action: null,
        actionLabel: null
    },
    'auth/phone-mismatch': {
        title: 'Registered Phone Mismatch',
        detail: 'The phone number you entered does not match the phone already linked to this account.',
        hint: 'Use your registered phone number for login, or contact support if the account needs recovery.',
        action: null,
        actionLabel: null
    },

    // ── OTP / Backend errors (matched by message content)
    'firebase phone verification is required': {
        title: 'Phone Verification Required',
        detail: 'Firebase phone verification must finish before the login can be completed.',
        hint: 'Request a fresh code and finish the phone step before signing in again.',
        action: null,
        actionLabel: null
    },
    'verified phone number does not match': {
        title: 'Verified Phone Mismatch',
        detail: 'The verified Firebase phone number does not match the phone entered for this login.',
        hint: 'Use the registered phone number tied to this account and try again.',
        action: null,
        actionLabel: null
    },
    'phone number does not match your registered account': {
        title: 'Registered Phone Mismatch',
        detail: 'The verified phone number does not match the account record.',
        hint: 'Use the phone number already registered on the account, or contact support for recovery.',
        action: null,
        actionLabel: null
    },
    'email address does not match your registered account': {
        title: 'Registered Email Mismatch',
        detail: 'The email address does not match the account record for this phone number.',
        hint: 'Use the same email address that was used when this account was created.',
        action: null,
        actionLabel: null
    },
    'email otp verification is required before completing phone factor login': {
        title: 'Email Verification Required',
        detail: 'Finish the email OTP step before completing phone verification.',
        hint: 'Start the secure sign-in flow again and enter the email code first.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'email otp verification expired': {
        title: 'Email Code Expired',
        detail: 'The verified email step has expired for this login attempt.',
        hint: 'Request fresh login codes to your email and phone, then try again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'signup email verification is required before completing phone verification': {
        title: 'Email Verification Required',
        detail: 'Finish the signup email OTP step before completing phone verification.',
        hint: 'Start the signup verification flow again and enter the email code first.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'signup email verification expired': {
        title: 'Signup Verification Expired',
        detail: 'Your verified signup email step has expired.',
        hint: 'Request fresh signup codes to your email and phone, then try again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'password recovery email verification is required before completing phone verification': {
        title: 'Recovery Email Verification Required',
        detail: 'Finish the recovery email OTP step before completing phone verification.',
        hint: 'Start the recovery flow again and enter the email code first.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'password recovery email verification expired': {
        title: 'Recovery Verification Expired',
        detail: 'Your verified recovery email step has expired.',
        hint: 'Request fresh recovery codes to your email and phone, then try again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'password reset verification is required before setting a new password': {
        title: 'Reset Verification Required',
        detail: 'Verify the recovery OTP before choosing a new password.',
        hint: 'Start the forgot-password flow again and complete the OTP step first.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'password reset verification expired': {
        title: 'Recovery Session Expired',
        detail: 'Your verified recovery session has expired.',
        hint: 'Request a fresh OTP to your registered email and phone, then try again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'password reset account is not ready': {
        title: 'Account Recovery Unavailable',
        detail: 'We could not find a password-auth account ready for reset.',
        hint: 'Contact support if this account was created recently or was migrated from another sign-in method.',
        action: null,
        actionLabel: null
    },
    'unable to update password right now': {
        title: 'Password Update Failed',
        detail: 'We could not finish updating your password right now.',
        hint: 'Please try again in a moment. If this continues, contact support.',
        action: null,
        actionLabel: null
    },
    'password contains sequential characters': {
        title: 'Password Too Predictable',
        detail: 'Your new password contains an easy-to-guess sequence.',
        hint: 'Avoid patterns like 123, abc, or similar runs of characters.',
        action: null,
        actionLabel: null
    },
    'password contains repeated characters': {
        title: 'Password Too Predictable',
        detail: 'Your new password repeats the same character too many times.',
        hint: 'Use a more varied password with mixed words, numbers, and symbols.',
        action: null,
        actionLabel: null
    },
    'password contains common date patterns': {
        title: 'Password Too Predictable',
        detail: 'Your new password contains a common date-like pattern.',
        hint: 'Avoid birthdays, years, and obvious numeric sequences.',
        action: null,
        actionLabel: null
    },
    'password follows keyboard patterns': {
        title: 'Password Too Predictable',
        detail: 'Your new password follows an easy keyboard pattern.',
        hint: 'Avoid patterns like qwerty, asdf, or similar keyboard runs.',
        action: null,
        actionLabel: null
    },
    'phone number does not match your pending signup': {
        title: 'Pending Signup Mismatch',
        detail: 'The verified phone number does not match the phone entered for this signup.',
        hint: 'Use the same phone number you entered when you started the signup flow.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'you are already signed in': {
        title: 'Already Signed In',
        detail: 'This browser session is already authenticated.',
        hint: 'Log out first if you want to create a different account.',
        action: null,
        actionLabel: null
    },
    'no verified account found for this email and phone number': {
        title: 'Account Not Ready',
        detail: 'We could not find a verified account matching this email and phone number.',
        hint: 'Create your account first, then sign in with the same email, phone, and password.',
        action: 'signup',
        actionLabel: 'Sign up'
    },
    'no account found with this phone': {
        title: 'Verification Required',
        detail: 'We could not verify those account details for OTP.',
        hint: 'Recheck your email and phone details, then request a new code.',
        action: null,
        actionLabel: null
    },
    'no account found with this email': {
        title: 'Verification Required',
        detail: 'We could not verify those account details for OTP.',
        hint: 'Recheck your email and phone details, then request a new code.',
        action: null,
        actionLabel: null
    },
    'no account found': {
        title: 'Verification Required',
        detail: 'We could not verify those account details for OTP.',
        hint: 'Recheck your email and phone details, then request a new code.',
        action: null,
        actionLabel: null
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
    'if account details are valid, verification will proceed': {
        title: 'Verification In Progress',
        detail: 'If your account details are valid, we\'ll continue with verification.',
        hint: 'Please recheck your email and phone number, then try again.',
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
    'csrf token fetch failed for /auth/sync: http 401': {
        title: 'Session Expired',
        detail: 'This browser was holding an old sign-in token, so the secure session sync was rejected.',
        hint: 'Your stale session has been cleared. Sign in again to continue.',
        action: 'signin',
        actionLabel: 'Sign in again'
    },
    'not authorized, token failed': {
        title: 'Session Expired',
        detail: 'Your sign-in token is no longer valid for secure account access.',
        hint: 'Sign in again to refresh your secure session.',
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

    const primaryErrorValue = (
        rawError?.code
        ?? rawError?.message
        ?? rawError?.data?.message
        ?? rawError
        ?? ''
    );
    const errorStr = String(primaryErrorValue).toLowerCase();

    if (rawError?.code === 'auth/social-invalid-credential') {
        return buildSocialInvalidCredentialError(rawError);
    }

    if (
        rawError?.code === 'auth/invalid-credential'
        && (rawError?.provider || rawError?.providerId || rawError?.customData?.providerId)
    ) {
        return buildSocialInvalidCredentialError(rawError);
    }

    if (rawError?.code === 'auth/account-exists-with-different-credential') {
        return buildAccountExistsWithDifferentCredentialError(rawError);
    }

    if (
        rawError?.code === 'auth/social-email-missing'
        || errorStr.includes('did not provide an email')
        || errorStr.includes('authenticated account is missing email')
    ) {
        return buildSocialMissingEmailError(rawError);
    }

    if (rawError?.code === 'auth/unauthorized-domain') {
        return buildUnauthorizedDomainError(rawError);
    }

    if (errorStr.includes('illegal url for new iframe')) {
        return buildIllegalIframeError(rawError);
    }

    // Try exact Firebase code match first
    if (rawError.code && AUTH_ERRORS[rawError.code]) {
        return AUTH_ERRORS[rawError.code];
    }

    // Try substring match against message
    for (const [key, value] of Object.entries(AUTH_ERRORS)) {
        if (key === 'default') continue;
        if (errorStr.includes(key)) return value;
    }

    const fallbackDetail = String(rawError?.message || rawError?.detail || rawError || '').trim();
    return { ...AUTH_ERRORS['default'], ...(fallbackDetail ? { detail: fallbackDetail } : {}) };
};

/**
 * Human-friendly SUCCESS messages for each auth action.
 */
export const AUTH_SUCCESS = {
    otp_sent: {
        title: 'Code Sent!',
        detail: 'If the account details are valid, a 6-digit verification code has been sent.'
    },
    otp_resent: {
        title: 'New Code Sent!',
        detail: 'If the account details are valid, a fresh verification code has been sent.'
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
    },
    password_reset_success: {
        title: 'Password Updated!',
        detail: 'Your password was changed successfully. Sign in with the new password now.'
    }
};
