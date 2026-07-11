import { defineMessages } from 'react-intl';

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
        case 'microsoft':
        case 'microsoft.com':
            return 'Microsoft';
        case 'apple':
        case 'apple.com':
            return 'Apple';
        default:
            return provider || 'Social';
    }
};

const resolveErrorProvider = (rawError) => formatAuthProviderLabel(
    rawError?.provider
    || rawError?.providerId
    || rawError?.credential?.providerId
    || rawError?.customData?.providerId
    || rawError?.customData?._tokenResponse?.providerId
    || rawError?.customData?._tokenResponse?.federatedId
    || rawError?.data?.provider
    || rawError?.data?.providerId
    || ''
);

const buildSocialInvalidCredentialError = (rawError, t) => {
    const provider = resolveErrorProvider(rawError);

    return {
        title: formatAuthMessage(t, 'auth.error.socialInvalidCredentialProvider.title', { provider }, '{provider} Sign-In Failed', `${provider} Sign-In Failed`),
        detail: formatAuthMessage(t, 'auth.error.socialInvalidCredentialProvider.detail', { provider }, 'We couldn\'t complete {provider} authentication for this app.', `We couldn't complete ${provider} authentication for this app.`),
        hint: formatAuthMessage(t, 'auth.error.socialInvalidCredentialProvider.hint', { provider }, 'Re-save the {provider} provider keys in Firebase, confirm the callback URL uses your Firebase auth handler, and make sure {provider} can return an email address for this account.', `Re-save the ${provider} provider keys in Firebase, confirm the callback URL uses your Firebase auth handler, and make sure ${provider} can return an email address for this account.`),
        action: null,
        actionLabel: null
    };
};

const buildAccountExistsWithDifferentCredentialError = (rawError, t) => {
    const provider = resolveErrorProvider(rawError);
    const email = String(rawError?.email || rawError?.customData?.email || '').trim();

    return {
        title: formatAuthMessage(t, 'auth.error.accountExistsWithDifferentCredentialProvider.title', { provider }, '{provider} Account Already Exists', `${provider} Account Already Exists`),
        detail: email
            ? formatAuthMessage(t, 'auth.error.accountExistsWithDifferentCredentialProvider.detailWithEmail', { email }, 'The email {email} is already linked to a different sign-in method.', `The email ${email} is already linked to a different sign-in method.`)
            : formatAuthMessage(t, 'auth.error.accountExistsWithDifferentCredentialProvider.detail', {}, 'This email is already linked to a different sign-in method.'),
        hint: formatAuthMessage(t, 'auth.error.accountExistsWithDifferentCredentialProvider.hint', { provider }, 'Sign in using the existing provider for this account first, then link {provider} after login.', `Sign in using the existing provider for this account first, then link ${provider} after login.`),
        action: 'signin',
        actionLabel: formatAuthMessage(t, 'auth.error.accountExistsWithDifferentCredentialProvider.actionLabel', {}, 'Sign in with existing method')
    };
};

const buildSocialMissingEmailError = (rawError, t) => {
    const provider = resolveErrorProvider(rawError);

    return {
        title: formatAuthMessage(t, 'auth.error.socialMissingEmailProvider.title', { provider }, '{provider} Email Access Required', `${provider} Email Access Required`),
        detail: formatAuthMessage(t, 'auth.error.socialMissingEmailProvider.detail', { provider }, '{provider} did not return an email address for this account.', `${provider} did not return an email address for this account.`),
        hint: formatAuthMessage(t, 'auth.error.socialMissingEmailProvider.hint', { provider }, 'This app needs an email from {provider} to attach your profile. Use an account with email access enabled, or continue with email and OTP sign-in.', `This app needs an email from ${provider} to attach your profile. Use an account with email access enabled, or continue with email and OTP sign-in.`),
        action: null,
        actionLabel: null
    };
};

const buildSocialSessionSyncError = (rawError, t) => {
    const provider = resolveErrorProvider(rawError);
    const requestId = String(
        rawError?.serverRequestId
        || rawError?.requestId
        || rawError?.data?.requestId
        || ''
    ).trim();

    return {
        title: formatAuthMessage(t, 'auth.error.socialSessionSyncProvider.title', { provider }, '{provider} Sign-In Needs Retry', `${provider} Sign-In Needs Retry`),
        detail: formatAuthMessage(t, 'auth.error.socialSessionSyncProvider.detail', { provider }, '{provider} authenticated, but Aura could not finish opening your marketplace session.', `${provider} authenticated, but Aura could not finish opening your marketplace session.`),
        hint: requestId
            ? formatAuthMessage(t, 'auth.error.socialSessionSyncProvider.hintWithRequestId', { requestId }, 'Try again once. If it repeats, use email and OTP sign-in while support checks session sync reference {requestId}.', `Try again once. If it repeats, use email and OTP sign-in while support checks session sync reference ${requestId}.`)
            : formatAuthMessage(t, 'auth.error.socialSessionSyncProvider.hint', {}, 'Try again once. If it repeats, use email and OTP sign-in while support checks the session sync service.'),
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

const buildUnauthorizedDomainError = (rawError, t) => {
    const host = normalizeErrorHost(rawError?.host || '');

    return {
        title: formatAuthMessage(t, 'auth.error.unauthorizedDomain.title', {}, 'Domain Not Authorized'),
        detail: formatAuthMessage(t, 'auth.error.unauthorizedDomain.detail', {}, 'This app URL is not allowed in Firebase Authentication.'),
        hint: isIpLiteralHost(host)
            ? formatAuthMessage(t, 'auth.error.unauthorizedDomain.ipHint', { host }, 'Authorize {host} in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Redirect flow can work on that host only after Firebase authorizes it.', `Authorize ${host} in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Redirect flow can work on that host only after Firebase authorizes it.`)
            : formatAuthMessage(t, 'auth.error.unauthorizedDomain.hint', {}, 'Add the active site domain in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Email and OTP sign-in remain available immediately.'),
        action: null,
        actionLabel: null
    };
};

const buildIllegalIframeError = (rawError, t) => {
    const host = normalizeErrorHost(rawError?.host || '');

    return {
        title: formatAuthMessage(t, 'auth.error.illegalIframe.title', {}, 'Domain Not Authorized'),
        detail: formatAuthMessage(t, 'auth.error.illegalIframe.detail', {}, 'Firebase rejected the current site host for popup-based sign-in.'),
        hint: isIpLiteralHost(host)
            ? formatAuthMessage(t, 'auth.error.illegalIframe.ipHint', { host }, 'Authorize {host} in Firebase Authentication settings, or switch to localhost for local popup testing. Email and OTP sign-in remain available immediately.', `Authorize ${host} in Firebase Authentication settings, or switch to localhost for local popup testing. Email and OTP sign-in remain available immediately.`)
            : formatAuthMessage(t, 'auth.error.illegalIframe.hint', {}, 'Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in.'),
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
    'auth/error-code:-26': {
        title: 'Secure Sign-In Interrupted',
        detail: 'Firebase could not finish issuing the session proof for this sign-in.',
        hint: 'Close stale sign-in tabs, return to Aura Desktop, and start a fresh browser sign-in.',
        action: 'signin',
        actionLabel: 'Start fresh sign-in'
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
    'too many password reset attempts': {
        title: 'Too Many Reset Attempts',
        detail: 'This password reset was tried too many times.',
        hint: 'Wait a few minutes, then request a fresh OTP before resetting your password again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    'too many requests for this route': {
        title: 'Too Many Requests',
        detail: 'This security flow was temporarily rate limited.',
        hint: 'Wait a few minutes, then start the recovery flow again.',
        action: 'back',
        actionLabel: 'Start over'
    },
    TRAFFIC_BUDGET_DENIED: {
        title: 'Too Many Requests',
        detail: 'This security flow was temporarily rate limited.',
        hint: 'Wait a few minutes, then start the recovery flow again.',
        action: 'back',
        actionLabel: 'Start over'
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
    'auth/desktop-browser-sign-in-cancelled': {
        title: 'Sign-In Cancelled',
        detail: 'Aura stopped waiting for the browser and invalidated the local sign-in request.',
        hint: 'Click "Continue in Browser" whenever you are ready to start a fresh request.',
        action: null,
        actionLabel: null
    },
    'hosted desktop sign-in is out of date': {
        title: 'Authentication Misconfigured',
        detail: 'Aura Desktop and the hosted browser login are not using the same sign-in protocol.',
        hint: 'Update the hosted Aura login before retrying. No browser request was opened.',
        action: null,
        actionLabel: null
    },
    'aura could not verify the hosted browser sign-in service': {
        title: 'Connection Problem',
        detail: 'Aura could not verify that the hosted browser login is compatible with this desktop release.',
        hint: 'Check your connection and try again. Owner Access remains available on configured desktop installs.',
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
    'auth/social-session-sync-failed': {
        title: 'Social Sign-In Needs Retry',
        detail: 'The social provider authenticated, but Aura could not finish opening your marketplace session.',
        hint: 'Try again once. If it repeats, use email and OTP sign-in while support checks the session sync service.',
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
        detail: 'Google, Facebook, GitHub, X, Microsoft, and Apple sign-in are disabled by deployment configuration.',
        hint: 'Use email and OTP sign-in for now, or enable social sign-in in the frontend deployment settings.',
        action: null,
        actionLabel: null
    },
    'auth/native-social-auth-configuration-missing': {
        title: 'Mobile Social Sign-In Not Ready',
        detail: 'The installed app needs native Android/iOS OAuth credentials before Google, Facebook, GitHub, X, Microsoft, or Apple can complete sign-in.',
        hint: 'Use email and OTP sign-in in the app for now. Native social sign-in can be enabled after the Firebase mobile app config and provider credentials are attached to the release build.',
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
    'dpop jti replay detected': {
        title: 'Secure Sign-In Needs Retry',
        detail: 'Aura rejected a repeated browser proof while opening your session.',
        hint: 'Refresh the page once and sign in again. Your password and OTP remain protected.',
        action: 'signin',
        actionLabel: 'Try sign-in again'
    },
    'dpop verification failed': {
        title: 'Secure Sign-In Needs Retry',
        detail: 'Aura could not verify the browser proof for this sign-in attempt.',
        hint: 'Refresh the page once and sign in again. If it repeats, clear this site session and retry.',
        action: 'signin',
        actionLabel: 'Try sign-in again'
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

const authFeedbackMessages = defineMessages({
    "auth.error.accountExistsWithDifferentCredential.actionLabel": {
        id: "auth.error.accountExistsWithDifferentCredential.actionLabel",
        defaultMessage: "Sign in with existing method",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredential.detail": {
        id: "auth.error.accountExistsWithDifferentCredential.detail",
        defaultMessage: "This email is already linked to a different sign-in method.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredential.hint": {
        id: "auth.error.accountExistsWithDifferentCredential.hint",
        defaultMessage: "Sign in with the existing method for this email, then link the new provider later.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredential.title": {
        id: "auth.error.accountExistsWithDifferentCredential.title",
        defaultMessage: "Account Already Exists",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredentialProvider.actionLabel": {
        id: "auth.error.accountExistsWithDifferentCredentialProvider.actionLabel",
        defaultMessage: "Sign in with existing method",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredentialProvider.detail": {
        id: "auth.error.accountExistsWithDifferentCredentialProvider.detail",
        defaultMessage: "This email is already linked to a different sign-in method.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredentialProvider.detailWithEmail": {
        id: "auth.error.accountExistsWithDifferentCredentialProvider.detailWithEmail",
        defaultMessage: "The email {email} is already linked to a different sign-in method.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredentialProvider.hint": {
        id: "auth.error.accountExistsWithDifferentCredentialProvider.hint",
        defaultMessage: "Sign in using the existing provider for this account first, then link {provider} after login.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountExistsWithDifferentCredentialProvider.title": {
        id: "auth.error.accountExistsWithDifferentCredentialProvider.title",
        defaultMessage: "{provider} Account Already Exists",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisEmailAlreadyExists.actionLabel": {
        id: "auth.error.accountWithThisEmailAlreadyExists.actionLabel",
        defaultMessage: "Sign in to my account",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisEmailAlreadyExists.detail": {
        id: "auth.error.accountWithThisEmailAlreadyExists.detail",
        defaultMessage: "An account already exists with this email address.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisEmailAlreadyExists.hint": {
        id: "auth.error.accountWithThisEmailAlreadyExists.hint",
        defaultMessage: "Sign in to your existing account instead.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisEmailAlreadyExists.title": {
        id: "auth.error.accountWithThisEmailAlreadyExists.title",
        defaultMessage: "Email Already Registered",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisPhoneNumberAlreadyExists.actionLabel": {
        id: "auth.error.accountWithThisPhoneNumberAlreadyExists.actionLabel",
        defaultMessage: "Sign in to my account",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisPhoneNumberAlreadyExists.detail": {
        id: "auth.error.accountWithThisPhoneNumberAlreadyExists.detail",
        defaultMessage: "An account with this phone number already exists.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisPhoneNumberAlreadyExists.hint": {
        id: "auth.error.accountWithThisPhoneNumberAlreadyExists.hint",
        defaultMessage: "Sign in using the email associated with this phone number.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.accountWithThisPhoneNumberAlreadyExists.title": {
        id: "auth.error.accountWithThisPhoneNumberAlreadyExists.title",
        defaultMessage: "Phone Already Registered",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.billingNotEnabled.detail": {
        id: "auth.error.billingNotEnabled.detail",
        defaultMessage: "Firebase phone verification is not enabled for this project billing setup.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.billingNotEnabled.hint": {
        id: "auth.error.billingNotEnabled.hint",
        defaultMessage: "Use the secure backup OTP route for now, or enable Firebase billing for phone authentication in the project console.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.billingNotEnabled.title": {
        id: "auth.error.billingNotEnabled.title",
        defaultMessage: "Phone Verification Provider Unavailable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.captchaCheckFailed.detail": {
        id: "auth.error.captchaCheckFailed.detail",
        defaultMessage: "The Firebase phone verification challenge did not validate cleanly.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.captchaCheckFailed.hint": {
        id: "auth.error.captchaCheckFailed.hint",
        defaultMessage: "Retry the challenge and make sure browser protections are not blocking reCAPTCHA.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.captchaCheckFailed.title": {
        id: "auth.error.captchaCheckFailed.title",
        defaultMessage: "Security Check Failed",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.codeExpired.actionLabel": {
        id: "auth.error.codeExpired.actionLabel",
        defaultMessage: "Send a new code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.codeExpired.detail": {
        id: "auth.error.codeExpired.detail",
        defaultMessage: "That phone verification code is no longer valid.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.codeExpired.hint": {
        id: "auth.error.codeExpired.hint",
        defaultMessage: "Request a fresh code and try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.codeExpired.title": {
        id: "auth.error.codeExpired.title",
        defaultMessage: "Code Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.configurationUnavailable.detail": {
        id: "auth.error.configurationUnavailable.detail",
        defaultMessage: "Firebase authentication is not configured correctly for this deployment.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.configurationUnavailable.hint": {
        id: "auth.error.configurationUnavailable.hint",
        defaultMessage: "The site can still load, but sign-in features will stay unavailable until the Firebase web config is fixed.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.configurationUnavailable.title": {
        id: "auth.error.configurationUnavailable.title",
        defaultMessage: "Authentication Not Configured",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.actionLabel": {
        id: "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.actionLabel",
        defaultMessage: "Sign in again",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.detail": {
        id: "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.detail",
        defaultMessage: "This browser was holding an old sign-in token, so the secure session sync was rejected.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.hint": {
        id: "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.hint",
        defaultMessage: "Your stale session has been cleared. Sign in again to continue.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.title": {
        id: "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.title",
        defaultMessage: "Session Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.default.detail": {
        id: "auth.error.default.detail",
        defaultMessage: "An unexpected error occurred during sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.default.hint": {
        id: "auth.error.default.hint",
        defaultMessage: "Please try again. If this continues, contact support.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.default.title": {
        id: "auth.error.default.title",
        defaultMessage: "Something Went Wrong",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopJtiReplayDetected.actionLabel": {
        id: "auth.error.dpopJtiReplayDetected.actionLabel",
        defaultMessage: "Try sign-in again",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopJtiReplayDetected.detail": {
        id: "auth.error.dpopJtiReplayDetected.detail",
        defaultMessage: "Aura rejected a repeated browser proof while opening your session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopJtiReplayDetected.hint": {
        id: "auth.error.dpopJtiReplayDetected.hint",
        defaultMessage: "Refresh the page once and sign in again. Your password and OTP remain protected.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopJtiReplayDetected.title": {
        id: "auth.error.dpopJtiReplayDetected.title",
        defaultMessage: "Secure Sign-In Needs Retry",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopVerificationFailed.actionLabel": {
        id: "auth.error.dpopVerificationFailed.actionLabel",
        defaultMessage: "Try sign-in again",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopVerificationFailed.detail": {
        id: "auth.error.dpopVerificationFailed.detail",
        defaultMessage: "Aura could not verify the browser proof for this sign-in attempt.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopVerificationFailed.hint": {
        id: "auth.error.dpopVerificationFailed.hint",
        defaultMessage: "Refresh the page once and sign in again. If it repeats, clear this site session and retry.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.dpopVerificationFailed.title": {
        id: "auth.error.dpopVerificationFailed.title",
        defaultMessage: "Secure Sign-In Needs Retry",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.detail": {
        id: "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.detail",
        defaultMessage: "The email address does not match the account record for this phone number.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.hint": {
        id: "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.hint",
        defaultMessage: "Use the same email address that was used when this account was created.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.title": {
        id: "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.title",
        defaultMessage: "Registered Email Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAlreadyInUse.actionLabel": {
        id: "auth.error.emailAlreadyInUse.actionLabel",
        defaultMessage: "Sign in instead",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAlreadyInUse.detail": {
        id: "auth.error.emailAlreadyInUse.detail",
        defaultMessage: "An account already exists with this email.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAlreadyInUse.hint": {
        id: "auth.error.emailAlreadyInUse.hint",
        defaultMessage: "Sign in instead, or use \"Forgot Password?\" if you've lost access.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailAlreadyInUse.title": {
        id: "auth.error.emailAlreadyInUse.title",
        defaultMessage: "Email Already Registered",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationExpired.actionLabel": {
        id: "auth.error.emailOtpVerificationExpired.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationExpired.detail": {
        id: "auth.error.emailOtpVerificationExpired.detail",
        defaultMessage: "The verified email step has expired for this login attempt.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationExpired.hint": {
        id: "auth.error.emailOtpVerificationExpired.hint",
        defaultMessage: "Request fresh login codes to your email and phone, then try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationExpired.title": {
        id: "auth.error.emailOtpVerificationExpired.title",
        defaultMessage: "Email Code Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.actionLabel": {
        id: "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.detail": {
        id: "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.detail",
        defaultMessage: "Finish the email OTP step before completing phone verification.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.hint": {
        id: "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.hint",
        defaultMessage: "Start the secure sign-in flow again and enter the email code first.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.title": {
        id: "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.title",
        defaultMessage: "Email Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.enterComplete6DigitOtp.detail": {
        id: "auth.error.enterComplete6DigitOtp.detail",
        defaultMessage: "Please fill in all 6 digits of your verification code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.enterComplete6DigitOtp.hint": {
        id: "auth.error.enterComplete6DigitOtp.hint",
        defaultMessage: "Check your email inbox for the code. Look in your Spam folder too!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.enterComplete6DigitOtp.title": {
        id: "auth.error.enterComplete6DigitOtp.title",
        defaultMessage: "Incomplete Code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.failedToSendOtp.detail": {
        id: "auth.error.failedToSendOtp.detail",
        defaultMessage: "We had trouble sending your verification code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.failedToSendOtp.hint": {
        id: "auth.error.failedToSendOtp.hint",
        defaultMessage: "Check your email address is correct and try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.failedToSendOtp.title": {
        id: "auth.error.failedToSendOtp.title",
        defaultMessage: "Couldn't Send Code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.firebasePhoneVerificationIsRequired.detail": {
        id: "auth.error.firebasePhoneVerificationIsRequired.detail",
        defaultMessage: "Firebase phone verification must finish before the login can be completed.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.firebasePhoneVerificationIsRequired.hint": {
        id: "auth.error.firebasePhoneVerificationIsRequired.hint",
        defaultMessage: "Request a fresh code and finish the phone step before signing in again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.firebasePhoneVerificationIsRequired.title": {
        id: "auth.error.firebasePhoneVerificationIsRequired.title",
        defaultMessage: "Phone Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.googleSignInFailed.detail": {
        id: "auth.error.googleSignInFailed.detail",
        defaultMessage: "We couldn't complete Google authentication.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.googleSignInFailed.hint": {
        id: "auth.error.googleSignInFailed.hint",
        defaultMessage: "Try again, or sign in manually with your email and password.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.googleSignInFailed.title": {
        id: "auth.error.googleSignInFailed.title",
        defaultMessage: "Google Sign-In Failed",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.ifAccountDetailsAreValidVerificationWillProceed.detail": {
        id: "auth.error.ifAccountDetailsAreValidVerificationWillProceed.detail",
        defaultMessage: "If your account details are valid, we'll continue with verification.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.ifAccountDetailsAreValidVerificationWillProceed.hint": {
        id: "auth.error.ifAccountDetailsAreValidVerificationWillProceed.hint",
        defaultMessage: "Please recheck your email and phone number, then try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.ifAccountDetailsAreValidVerificationWillProceed.title": {
        id: "auth.error.ifAccountDetailsAreValidVerificationWillProceed.title",
        defaultMessage: "Verification In Progress",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalIframe.detail": {
        id: "auth.error.illegalIframe.detail",
        defaultMessage: "Firebase rejected the current site host for popup-based sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalIframe.hint": {
        id: "auth.error.illegalIframe.hint",
        defaultMessage: "Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalIframe.ipHint": {
        id: "auth.error.illegalIframe.ipHint",
        defaultMessage: "Authorize {host} in Firebase Authentication settings, or switch to localhost for local popup testing. Email and OTP sign-in remain available immediately.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalIframe.title": {
        id: "auth.error.illegalIframe.title",
        defaultMessage: "Domain Not Authorized",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalUrlForNewIframe.detail": {
        id: "auth.error.illegalUrlForNewIframe.detail",
        defaultMessage: "Firebase rejected the current site host for popup-based sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalUrlForNewIframe.hint": {
        id: "auth.error.illegalUrlForNewIframe.hint",
        defaultMessage: "Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.illegalUrlForNewIframe.title": {
        id: "auth.error.illegalUrlForNewIframe.title",
        defaultMessage: "Domain Not Authorized",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidApiKey.detail": {
        id: "auth.error.invalidApiKey.detail",
        defaultMessage: "The deployed Firebase API key is invalid for this frontend.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidApiKey.hint": {
        id: "auth.error.invalidApiKey.hint",
        defaultMessage: "Fix the Firebase web app configuration for this deployed domain, then redeploy the frontend.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidApiKey.title": {
        id: "auth.error.invalidApiKey.title",
        defaultMessage: "Authentication Misconfigured",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidAppCredential.detail": {
        id: "auth.error.invalidAppCredential.detail",
        defaultMessage: "Firebase could not initialize the secure phone verification challenge.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidAppCredential.hint": {
        id: "auth.error.invalidAppCredential.hint",
        defaultMessage: "Retry once. If it still fails, the app can fall back to the secure backup OTP path.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidAppCredential.title": {
        id: "auth.error.invalidAppCredential.title",
        defaultMessage: "Phone Verification Blocked",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidCredential.actionLabel": {
        id: "auth.error.invalidCredential.actionLabel",
        defaultMessage: "Reset my password",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidCredential.detail": {
        id: "auth.error.invalidCredential.detail",
        defaultMessage: "Email or password is incorrect.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidCredential.hint": {
        id: "auth.error.invalidCredential.hint",
        defaultMessage: "Make sure you're using the email you registered with. Try \"Forgot Password?\" if you're stuck.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidCredential.title": {
        id: "auth.error.invalidCredential.title",
        defaultMessage: "Invalid Credentials",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidOtp.detail": {
        id: "auth.error.invalidOtp.detail",
        defaultMessage: "The 6-digit code you entered doesn't match what we sent.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidOtp.hint": {
        id: "auth.error.invalidOtp.hint",
        defaultMessage: "Check the email we sent — the code is exactly 6 digits. No spaces.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidOtp.title": {
        id: "auth.error.invalidOtp.title",
        defaultMessage: "Incorrect Code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidVerificationCode.detail": {
        id: "auth.error.invalidVerificationCode.detail",
        defaultMessage: "That phone verification code is not valid.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidVerificationCode.hint": {
        id: "auth.error.invalidVerificationCode.hint",
        defaultMessage: "Re-enter the latest 6-digit code, or request a fresh one.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.invalidVerificationCode.title": {
        id: "auth.error.invalidVerificationCode.title",
        defaultMessage: "Incorrect Code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.missingAppCredential.detail": {
        id: "auth.error.missingAppCredential.detail",
        defaultMessage: "The browser challenge for Firebase phone verification did not complete.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.missingAppCredential.hint": {
        id: "auth.error.missingAppCredential.hint",
        defaultMessage: "Retry once, then refresh if the challenge keeps failing.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.missingAppCredential.title": {
        id: "auth.error.missingAppCredential.title",
        defaultMessage: "Phone Verification Unavailable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.nativeSocialAuthConfigurationMissing.detail": {
        id: "auth.error.nativeSocialAuthConfigurationMissing.detail",
        defaultMessage: "The installed app needs native Android/iOS OAuth credentials before Google, Facebook, GitHub, X, Microsoft, or Apple can complete sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.nativeSocialAuthConfigurationMissing.hint": {
        id: "auth.error.nativeSocialAuthConfigurationMissing.hint",
        defaultMessage: "Use email and OTP sign-in in the app for now. Native social sign-in can be enabled after the Firebase mobile app config and provider credentials are attached to the release build.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.nativeSocialAuthConfigurationMissing.title": {
        id: "auth.error.nativeSocialAuthConfigurationMissing.title",
        defaultMessage: "Mobile Social Sign-In Not Ready",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.networkRequestFailed.detail": {
        id: "auth.error.networkRequestFailed.detail",
        defaultMessage: "We couldn't reach our authentication servers.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.networkRequestFailed.hint": {
        id: "auth.error.networkRequestFailed.hint",
        defaultMessage: "Check your internet connection and try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.networkRequestFailed.title": {
        id: "auth.error.networkRequestFailed.title",
        defaultMessage: "Connection Problem",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFound.detail": {
        id: "auth.error.noAccountFound.detail",
        defaultMessage: "We could not verify those account details for OTP.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFound.hint": {
        id: "auth.error.noAccountFound.hint",
        defaultMessage: "Recheck your email and phone details, then request a new code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFound.title": {
        id: "auth.error.noAccountFound.title",
        defaultMessage: "Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisEmail.detail": {
        id: "auth.error.noAccountFoundWithThisEmail.detail",
        defaultMessage: "We could not verify those account details for OTP.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisEmail.hint": {
        id: "auth.error.noAccountFoundWithThisEmail.hint",
        defaultMessage: "Recheck your email and phone details, then request a new code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisEmail.title": {
        id: "auth.error.noAccountFoundWithThisEmail.title",
        defaultMessage: "Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisPhone.detail": {
        id: "auth.error.noAccountFoundWithThisPhone.detail",
        defaultMessage: "We could not verify those account details for OTP.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisPhone.hint": {
        id: "auth.error.noAccountFoundWithThisPhone.hint",
        defaultMessage: "Recheck your email and phone details, then request a new code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noAccountFoundWithThisPhone.title": {
        id: "auth.error.noAccountFoundWithThisPhone.title",
        defaultMessage: "Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.notAuthorizedTokenFailed.actionLabel": {
        id: "auth.error.notAuthorizedTokenFailed.actionLabel",
        defaultMessage: "Sign in again",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.notAuthorizedTokenFailed.detail": {
        id: "auth.error.notAuthorizedTokenFailed.detail",
        defaultMessage: "Your sign-in token is no longer valid for secure account access.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.notAuthorizedTokenFailed.hint": {
        id: "auth.error.notAuthorizedTokenFailed.hint",
        defaultMessage: "Sign in again to refresh your secure session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.notAuthorizedTokenFailed.title": {
        id: "auth.error.notAuthorizedTokenFailed.title",
        defaultMessage: "Session Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.actionLabel": {
        id: "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.actionLabel",
        defaultMessage: "Sign up",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.detail": {
        id: "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.detail",
        defaultMessage: "We could not find a verified account matching this email and phone number.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.hint": {
        id: "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.hint",
        defaultMessage: "Create your account first, then sign in with the same email, phone, and password.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.title": {
        id: "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.title",
        defaultMessage: "Account Not Ready",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.operationNotAllowed.detail": {
        id: "auth.error.operationNotAllowed.detail",
        defaultMessage: "Firebase phone authentication is disabled for this project.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.operationNotAllowed.hint": {
        id: "auth.error.operationNotAllowed.hint",
        defaultMessage: "Enable Phone as a Firebase sign-in provider, or continue with the secure backup OTP route.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.operationNotAllowed.title": {
        id: "auth.error.operationNotAllowed.title",
        defaultMessage: "Phone Verification Disabled",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpHasExpired.actionLabel": {
        id: "auth.error.otpHasExpired.actionLabel",
        defaultMessage: "Send a new code",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpHasExpired.detail": {
        id: "auth.error.otpHasExpired.detail",
        defaultMessage: "Your verification code has expired (codes are valid for 5 minutes).",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpHasExpired.hint": {
        id: "auth.error.otpHasExpired.hint",
        defaultMessage: "Click \"Resend OTP\" below to get a fresh code.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpHasExpired.title": {
        id: "auth.error.otpHasExpired.title",
        defaultMessage: "Code Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpPurposeMismatch.actionLabel": {
        id: "auth.error.otpPurposeMismatch.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpPurposeMismatch.detail": {
        id: "auth.error.otpPurposeMismatch.detail",
        defaultMessage: "Something went wrong with your verification session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpPurposeMismatch.hint": {
        id: "auth.error.otpPurposeMismatch.hint",
        defaultMessage: "Go back and start the process again from the beginning.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.otpPurposeMismatch.title": {
        id: "auth.error.otpPurposeMismatch.title",
        defaultMessage: "Session Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsCommonDatePatterns.detail": {
        id: "auth.error.passwordContainsCommonDatePatterns.detail",
        defaultMessage: "Your new password contains a common date-like pattern.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsCommonDatePatterns.hint": {
        id: "auth.error.passwordContainsCommonDatePatterns.hint",
        defaultMessage: "Avoid birthdays, years, and obvious numeric sequences.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsCommonDatePatterns.title": {
        id: "auth.error.passwordContainsCommonDatePatterns.title",
        defaultMessage: "Password Too Predictable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsRepeatedCharacters.detail": {
        id: "auth.error.passwordContainsRepeatedCharacters.detail",
        defaultMessage: "Your new password repeats the same character too many times.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsRepeatedCharacters.hint": {
        id: "auth.error.passwordContainsRepeatedCharacters.hint",
        defaultMessage: "Use a more varied password with mixed words, numbers, and symbols.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsRepeatedCharacters.title": {
        id: "auth.error.passwordContainsRepeatedCharacters.title",
        defaultMessage: "Password Too Predictable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsSequentialCharacters.detail": {
        id: "auth.error.passwordContainsSequentialCharacters.detail",
        defaultMessage: "Your new password contains an easy-to-guess sequence.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsSequentialCharacters.hint": {
        id: "auth.error.passwordContainsSequentialCharacters.hint",
        defaultMessage: "Avoid patterns like 123, abc, or similar runs of characters.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordContainsSequentialCharacters.title": {
        id: "auth.error.passwordContainsSequentialCharacters.title",
        defaultMessage: "Password Too Predictable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordFollowsKeyboardPatterns.detail": {
        id: "auth.error.passwordFollowsKeyboardPatterns.detail",
        defaultMessage: "Your new password follows an easy keyboard pattern.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordFollowsKeyboardPatterns.hint": {
        id: "auth.error.passwordFollowsKeyboardPatterns.hint",
        defaultMessage: "Avoid patterns like qwerty, asdf, or similar keyboard runs.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordFollowsKeyboardPatterns.title": {
        id: "auth.error.passwordFollowsKeyboardPatterns.title",
        defaultMessage: "Password Too Predictable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordMustBeAtLeast6.detail": {
        id: "auth.error.passwordMustBeAtLeast6.detail",
        defaultMessage: "Your password must be at least 6 characters long.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordMustBeAtLeast6.hint": {
        id: "auth.error.passwordMustBeAtLeast6.hint",
        defaultMessage: "Use a mix of letters, numbers, and symbols for a strong password.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordMustBeAtLeast6.title": {
        id: "auth.error.passwordMustBeAtLeast6.title",
        defaultMessage: "Password Too Short",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationExpired.actionLabel": {
        id: "auth.error.passwordRecoveryEmailVerificationExpired.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationExpired.detail": {
        id: "auth.error.passwordRecoveryEmailVerificationExpired.detail",
        defaultMessage: "Your verified recovery email step has expired.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationExpired.hint": {
        id: "auth.error.passwordRecoveryEmailVerificationExpired.hint",
        defaultMessage: "Request fresh recovery codes to your email and phone, then try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationExpired.title": {
        id: "auth.error.passwordRecoveryEmailVerificationExpired.title",
        defaultMessage: "Recovery Verification Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel": {
        id: "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail": {
        id: "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail",
        defaultMessage: "Finish the recovery email OTP step before completing phone verification.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint": {
        id: "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint",
        defaultMessage: "Start the recovery flow again and enter the email code first.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title": {
        id: "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title",
        defaultMessage: "Recovery Email Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetAccountIsNotReady.detail": {
        id: "auth.error.passwordResetAccountIsNotReady.detail",
        defaultMessage: "We could not find a password-auth account ready for reset.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetAccountIsNotReady.hint": {
        id: "auth.error.passwordResetAccountIsNotReady.hint",
        defaultMessage: "Contact support if this account was created recently or was migrated from another sign-in method.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetAccountIsNotReady.title": {
        id: "auth.error.passwordResetAccountIsNotReady.title",
        defaultMessage: "Account Recovery Unavailable",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationExpired.actionLabel": {
        id: "auth.error.passwordResetVerificationExpired.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationExpired.detail": {
        id: "auth.error.passwordResetVerificationExpired.detail",
        defaultMessage: "Your verified recovery session has expired.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationExpired.hint": {
        id: "auth.error.passwordResetVerificationExpired.hint",
        defaultMessage: "Request a fresh OTP to your registered email and phone, then try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationExpired.title": {
        id: "auth.error.passwordResetVerificationExpired.title",
        defaultMessage: "Recovery Session Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.actionLabel": {
        id: "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.detail": {
        id: "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.detail",
        defaultMessage: "Verify the recovery OTP before choosing a new password.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.hint": {
        id: "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.hint",
        defaultMessage: "Start the forgot-password flow again and complete the OTP step first.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.title": {
        id: "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.title",
        defaultMessage: "Reset Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordsDoNotMatch.detail": {
        id: "auth.error.passwordsDoNotMatch.detail",
        defaultMessage: "Your password and confirmation don't match.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordsDoNotMatch.hint": {
        id: "auth.error.passwordsDoNotMatch.hint",
        defaultMessage: "Re-type your password carefully in both fields.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.passwordsDoNotMatch.title": {
        id: "auth.error.passwordsDoNotMatch.title",
        defaultMessage: "Passwords Don't Match",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneMismatch.detail": {
        id: "auth.error.phoneMismatch.detail",
        defaultMessage: "The phone number you entered does not match the phone already linked to this account.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneMismatch.hint": {
        id: "auth.error.phoneMismatch.hint",
        defaultMessage: "Use your registered phone number for login, or contact support if the account needs recovery.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneMismatch.title": {
        id: "auth.error.phoneMismatch.title",
        defaultMessage: "Registered Phone Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourPendingSignup.actionLabel": {
        id: "auth.error.phoneNumberDoesNotMatchYourPendingSignup.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourPendingSignup.detail": {
        id: "auth.error.phoneNumberDoesNotMatchYourPendingSignup.detail",
        defaultMessage: "The verified phone number does not match the phone entered for this signup.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourPendingSignup.hint": {
        id: "auth.error.phoneNumberDoesNotMatchYourPendingSignup.hint",
        defaultMessage: "Use the same phone number you entered when you started the signup flow.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourPendingSignup.title": {
        id: "auth.error.phoneNumberDoesNotMatchYourPendingSignup.title",
        defaultMessage: "Pending Signup Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.detail": {
        id: "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.detail",
        defaultMessage: "The verified phone number does not match the account record.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.hint": {
        id: "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.hint",
        defaultMessage: "Use the phone number already registered on the account, or contact support for recovery.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.title": {
        id: "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.title",
        defaultMessage: "Registered Phone Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberIsRequired.detail": {
        id: "auth.error.phoneNumberIsRequired.detail",
        defaultMessage: "Please enter your registered phone number.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberIsRequired.hint": {
        id: "auth.error.phoneNumberIsRequired.hint",
        defaultMessage: "Include the country code, e.g. +91 98765 43210",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.phoneNumberIsRequired.title": {
        id: "auth.error.phoneNumberIsRequired.title",
        defaultMessage: "Phone Number Missing",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.popupClosedByUser.detail": {
        id: "auth.error.popupClosedByUser.detail",
        defaultMessage: "The social sign-in window was closed before completing.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.popupClosedByUser.hint": {
        id: "auth.error.popupClosedByUser.hint",
        defaultMessage: "Open the provider window again and complete the sign-in flow.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.popupClosedByUser.title": {
        id: "auth.error.popupClosedByUser.title",
        defaultMessage: "Sign-In Cancelled",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.quotaExceeded.detail": {
        id: "auth.error.quotaExceeded.detail",
        defaultMessage: "Firebase temporarily throttled phone verification requests for this project.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.quotaExceeded.hint": {
        id: "auth.error.quotaExceeded.hint",
        defaultMessage: "Wait a bit before retrying, or use the secure backup OTP route if it appears.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.quotaExceeded.title": {
        id: "auth.error.quotaExceeded.title",
        defaultMessage: "Too Many OTP Requests",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationExpired.actionLabel": {
        id: "auth.error.signupEmailVerificationExpired.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationExpired.detail": {
        id: "auth.error.signupEmailVerificationExpired.detail",
        defaultMessage: "Your verified signup email step has expired.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationExpired.hint": {
        id: "auth.error.signupEmailVerificationExpired.hint",
        defaultMessage: "Request fresh signup codes to your email and phone, then try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationExpired.title": {
        id: "auth.error.signupEmailVerificationExpired.title",
        defaultMessage: "Signup Verification Expired",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel": {
        id: "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail": {
        id: "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail",
        defaultMessage: "Finish the signup email OTP step before completing phone verification.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint": {
        id: "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint",
        defaultMessage: "Start the signup verification flow again and enter the email code first.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title": {
        id: "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title",
        defaultMessage: "Email Verification Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialAuthDisabled.detail": {
        id: "auth.error.socialAuthDisabled.detail",
        defaultMessage: "Google, Facebook, GitHub, X, Microsoft, and Apple sign-in are disabled by deployment configuration.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialAuthDisabled.hint": {
        id: "auth.error.socialAuthDisabled.hint",
        defaultMessage: "Use email and OTP sign-in for now, or enable social sign-in in the frontend deployment settings.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialAuthDisabled.title": {
        id: "auth.error.socialAuthDisabled.title",
        defaultMessage: "Social Sign-In Disabled",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialEmailMissing.detail": {
        id: "auth.error.socialEmailMissing.detail",
        defaultMessage: "The social provider did not return an email address for this account.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialEmailMissing.hint": {
        id: "auth.error.socialEmailMissing.hint",
        defaultMessage: "Use a provider account that exposes an email address, or continue with email and OTP sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialEmailMissing.title": {
        id: "auth.error.socialEmailMissing.title",
        defaultMessage: "Social Email Access Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredential.detail": {
        id: "auth.error.socialInvalidCredential.detail",
        defaultMessage: "We could not complete social authentication for this app.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredential.hint": {
        id: "auth.error.socialInvalidCredential.hint",
        defaultMessage: "Check the OAuth provider configuration in Firebase and try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredential.title": {
        id: "auth.error.socialInvalidCredential.title",
        defaultMessage: "Social Sign-In Failed",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredentialProvider.detail": {
        id: "auth.error.socialInvalidCredentialProvider.detail",
        defaultMessage: "We couldn't complete {provider} authentication for this app.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredentialProvider.hint": {
        id: "auth.error.socialInvalidCredentialProvider.hint",
        defaultMessage: "Re-save the {provider} provider keys in Firebase, confirm the callback URL uses your Firebase auth handler, and make sure {provider} can return an email address for this account.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialInvalidCredentialProvider.title": {
        id: "auth.error.socialInvalidCredentialProvider.title",
        defaultMessage: "{provider} Sign-In Failed",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialMissingEmailProvider.detail": {
        id: "auth.error.socialMissingEmailProvider.detail",
        defaultMessage: "{provider} did not return an email address for this account.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialMissingEmailProvider.hint": {
        id: "auth.error.socialMissingEmailProvider.hint",
        defaultMessage: "This app needs an email from {provider} to attach your profile. Use an account with email access enabled, or continue with email and OTP sign-in.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialMissingEmailProvider.title": {
        id: "auth.error.socialMissingEmailProvider.title",
        defaultMessage: "{provider} Email Access Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncFailed.detail": {
        id: "auth.error.socialSessionSyncFailed.detail",
        defaultMessage: "The social provider authenticated, but Aura could not finish opening your marketplace session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncFailed.hint": {
        id: "auth.error.socialSessionSyncFailed.hint",
        defaultMessage: "Try again once. If it repeats, use email and OTP sign-in while support checks the session sync service.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncFailed.title": {
        id: "auth.error.socialSessionSyncFailed.title",
        defaultMessage: "Social Sign-In Needs Retry",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncProvider.detail": {
        id: "auth.error.socialSessionSyncProvider.detail",
        defaultMessage: "{provider} authenticated, but Aura could not finish opening your marketplace session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncProvider.hint": {
        id: "auth.error.socialSessionSyncProvider.hint",
        defaultMessage: "Try again once. If it repeats, use email and OTP sign-in while support checks the session sync service.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncProvider.hintWithRequestId": {
        id: "auth.error.socialSessionSyncProvider.hintWithRequestId",
        defaultMessage: "Try again once. If it repeats, use email and OTP sign-in while support checks session sync reference {requestId}.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.socialSessionSyncProvider.title": {
        id: "auth.error.socialSessionSyncProvider.title",
        defaultMessage: "{provider} Sign-In Needs Retry",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.temporarilySuspendedUntil.detail": {
        id: "auth.error.temporarilySuspendedUntil.detail",
        defaultMessage: "Your account is currently suspended by the trust and safety team.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.temporarilySuspendedUntil.hint": {
        id: "auth.error.temporarilySuspendedUntil.hint",
        defaultMessage: "Please contact support to request a review.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.temporarilySuspendedUntil.title": {
        id: "auth.error.temporarilySuspendedUntil.title",
        defaultMessage: "Account Suspended",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyFailedAttempts.actionLabel": {
        id: "auth.error.tooManyFailedAttempts.actionLabel",
        defaultMessage: "Reset password to unlock",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyFailedAttempts.detail": {
        id: "auth.error.tooManyFailedAttempts.detail",
        defaultMessage: "Too many failed attempts. Security lock is now active.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyFailedAttempts.hint": {
        id: "auth.error.tooManyFailedAttempts.hint",
        defaultMessage: "Wait 15 minutes, or reset your password to unlock immediately.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyFailedAttempts.title": {
        id: "auth.error.tooManyFailedAttempts.title",
        defaultMessage: "Account Temporarily Locked",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyRequests.actionLabel": {
        id: "auth.error.tooManyRequests.actionLabel",
        defaultMessage: "Reset & unlock my account",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyRequests.detail": {
        id: "auth.error.tooManyRequests.detail",
        defaultMessage: "Your account has been temporarily locked due to too many failed sign-in attempts.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyRequests.hint": {
        id: "auth.error.tooManyRequests.hint",
        defaultMessage: "Wait a few minutes and try again, or reset your password to regain access immediately.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyRequests.title": {
        id: "auth.error.tooManyRequests.title",
        defaultMessage: "Too Many Attempts",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyPasswordResetAttempts.actionLabel": {
        id: "auth.error.tooManyPasswordResetAttempts.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyPasswordResetAttempts.detail": {
        id: "auth.error.tooManyPasswordResetAttempts.detail",
        defaultMessage: "This password reset was tried too many times.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyPasswordResetAttempts.hint": {
        id: "auth.error.tooManyPasswordResetAttempts.hint",
        defaultMessage: "Wait a few minutes, then request a fresh OTP before resetting your password again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.tooManyPasswordResetAttempts.title": {
        id: "auth.error.tooManyPasswordResetAttempts.title",
        defaultMessage: "Too Many Reset Attempts",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.securityFlowRateLimited.actionLabel": {
        id: "auth.error.securityFlowRateLimited.actionLabel",
        defaultMessage: "Start over",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.securityFlowRateLimited.detail": {
        id: "auth.error.securityFlowRateLimited.detail",
        defaultMessage: "This security flow was temporarily rate limited.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.securityFlowRateLimited.hint": {
        id: "auth.error.securityFlowRateLimited.hint",
        defaultMessage: "Wait a few minutes, then start the recovery flow again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.securityFlowRateLimited.title": {
        id: "auth.error.securityFlowRateLimited.title",
        defaultMessage: "Too Many Requests",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unableToUpdatePasswordRightNow.detail": {
        id: "auth.error.unableToUpdatePasswordRightNow.detail",
        defaultMessage: "We could not finish updating your password right now.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unableToUpdatePasswordRightNow.hint": {
        id: "auth.error.unableToUpdatePasswordRightNow.hint",
        defaultMessage: "Please try again in a moment. If this continues, contact support.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unableToUpdatePasswordRightNow.title": {
        id: "auth.error.unableToUpdatePasswordRightNow.title",
        defaultMessage: "Password Update Failed",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unauthorizedDomain.detail": {
        id: "auth.error.unauthorizedDomain.detail",
        defaultMessage: "This app URL is not allowed in Firebase Authentication.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unauthorizedDomain.hint": {
        id: "auth.error.unauthorizedDomain.hint",
        defaultMessage: "Add the active site domain in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Email and OTP sign-in remain available immediately.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unauthorizedDomain.ipHint": {
        id: "auth.error.unauthorizedDomain.ipHint",
        defaultMessage: "Authorize {host} in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Redirect flow can work on that host only after Firebase authorizes it.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.unauthorizedDomain.title": {
        id: "auth.error.unauthorizedDomain.title",
        defaultMessage: "Domain Not Authorized",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userNotFound.actionLabel": {
        id: "auth.error.userNotFound.actionLabel",
        defaultMessage: "Get sign-in help",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userNotFound.detail": {
        id: "auth.error.userNotFound.detail",
        defaultMessage: "We could not verify those account details.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userNotFound.hint": {
        id: "auth.error.userNotFound.hint",
        defaultMessage: "Check your credentials and try again, or use \"Forgot Password?\" for help.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userNotFound.title": {
        id: "auth.error.userNotFound.title",
        defaultMessage: "Unable to Sign In",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userProfileMissingFromLoginDatabase.actionLabel": {
        id: "auth.error.userProfileMissingFromLoginDatabase.actionLabel",
        defaultMessage: "Sign in again",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userProfileMissingFromLoginDatabase.detail": {
        id: "auth.error.userProfileMissingFromLoginDatabase.detail",
        defaultMessage: "Your profile needs to be re-synced before continuing.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userProfileMissingFromLoginDatabase.hint": {
        id: "auth.error.userProfileMissingFromLoginDatabase.hint",
        defaultMessage: "Sign out and sign in again to recover your account session.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.userProfileMissingFromLoginDatabase.title": {
        id: "auth.error.userProfileMissingFromLoginDatabase.title",
        defaultMessage: "Session Recovery Required",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.validPhoneNumberIsRequired.detail": {
        id: "auth.error.validPhoneNumberIsRequired.detail",
        defaultMessage: "Please enter a valid phone number (10–15 digits).",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.validPhoneNumberIsRequired.hint": {
        id: "auth.error.validPhoneNumberIsRequired.hint",
        defaultMessage: "Include the country code, e.g. +91 98765 43210",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.validPhoneNumberIsRequired.title": {
        id: "auth.error.validPhoneNumberIsRequired.title",
        defaultMessage: "Invalid Phone Number",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.verifiedPhoneNumberDoesNotMatch.detail": {
        id: "auth.error.verifiedPhoneNumberDoesNotMatch.detail",
        defaultMessage: "The verified Firebase phone number does not match the phone entered for this login.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.verifiedPhoneNumberDoesNotMatch.hint": {
        id: "auth.error.verifiedPhoneNumberDoesNotMatch.hint",
        defaultMessage: "Use the registered phone number tied to this account and try again.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.verifiedPhoneNumberDoesNotMatch.title": {
        id: "auth.error.verifiedPhoneNumberDoesNotMatch.title",
        defaultMessage: "Verified Phone Mismatch",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.wrongPassword.actionLabel": {
        id: "auth.error.wrongPassword.actionLabel",
        defaultMessage: "Reset my password",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.wrongPassword.detail": {
        id: "auth.error.wrongPassword.detail",
        defaultMessage: "The password you entered doesn't match our records.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.wrongPassword.hint": {
        id: "auth.error.wrongPassword.hint",
        defaultMessage: "Double-check CAPS LOCK, or click \"Forgot Password?\" to reset it.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.wrongPassword.title": {
        id: "auth.error.wrongPassword.title",
        defaultMessage: "Wrong Password",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.youAreAlreadySignedIn.detail": {
        id: "auth.error.youAreAlreadySignedIn.detail",
        defaultMessage: "This browser session is already authenticated.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.youAreAlreadySignedIn.hint": {
        id: "auth.error.youAreAlreadySignedIn.hint",
        defaultMessage: "Log out first if you want to create a different account.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.youAreAlreadySignedIn.title": {
        id: "auth.error.youAreAlreadySignedIn.title",
        defaultMessage: "Already Signed In",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.yourAccountIsNotActive.detail": {
        id: "auth.error.yourAccountIsNotActive.detail",
        defaultMessage: "This account is no longer active.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.yourAccountIsNotActive.hint": {
        id: "auth.error.yourAccountIsNotActive.hint",
        defaultMessage: "Contact support for account recovery options.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.error.yourAccountIsNotActive.title": {
        id: "auth.error.yourAccountIsNotActive.title",
        defaultMessage: "Account Disabled",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpResent.detail": {
        id: "auth.success.otpResent.detail",
        defaultMessage: "If the account details are valid, a fresh verification code has been sent.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpResent.title": {
        id: "auth.success.otpResent.title",
        defaultMessage: "New Code Sent!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpSent.detail": {
        id: "auth.success.otpSent.detail",
        defaultMessage: "If the account details are valid, a 6-digit verification code has been sent.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpSent.title": {
        id: "auth.success.otpSent.title",
        defaultMessage: "Code Sent!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpVerified.detail": {
        id: "auth.success.otpVerified.detail",
        defaultMessage: "Your identity has been confirmed.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.otpVerified.title": {
        id: "auth.success.otpVerified.title",
        defaultMessage: "Verified!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.passwordResetSuccess.detail": {
        id: "auth.success.passwordResetSuccess.detail",
        defaultMessage: "Your password was changed successfully. Sign in with the new password now.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.passwordResetSuccess.title": {
        id: "auth.success.passwordResetSuccess.title",
        defaultMessage: "Password Updated!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.resetSent.detail": {
        id: "auth.success.resetSent.detail",
        defaultMessage: "Check your inbox for a password reset link.",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.resetSent.title": {
        id: "auth.success.resetSent.title",
        defaultMessage: "Reset Email Sent!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.signinSuccess.detail": {
        id: "auth.success.signinSuccess.detail",
        defaultMessage: "You're now signed in. Redirecting...",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.signinSuccess.title": {
        id: "auth.success.signinSuccess.title",
        defaultMessage: "Welcome Back!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.signupSuccess.detail": {
        id: "auth.success.signupSuccess.detail",
        defaultMessage: "Welcome to AURA! Setting up your account...",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
    "auth.success.signupSuccess.title": {
        id: "auth.success.signupSuccess.title",
        defaultMessage: "Account Created!",
        description: 'Stable auth feedback message surfaced in login and desktop auth flows.',
    },
});

const interpolateAuthMessage = (template = '', values = {}) => String(template || '').replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (match, key) => (values[key] === undefined || values[key] === null ? match : String(values[key]))
);

const formatAuthMessage = (t, id, values, defaultMessage, fallbackMessage = defaultMessage) => {
    const descriptor = authFeedbackMessages[id];
    const resolvedDefaultMessage = descriptor?.defaultMessage || defaultMessage;
    const fallbackText = fallbackMessage === defaultMessage
        ? interpolateAuthMessage(resolvedDefaultMessage, values)
        : fallbackMessage;
    if (typeof t !== 'function') return fallbackText;

    const formatted = t(id, values, resolvedDefaultMessage);
    if (!formatted || formatted === id || /\{[a-zA-Z0-9_]+\}/.test(formatted)) {
        return fallbackText;
    }
    return formatted;
};

const localizeStaticAuthError = (key, fallback, t) => {
    if (typeof t !== 'function' || !fallback) return fallback;

    switch (key) {
        case "auth/wrong-password":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.wrongPassword.title", {}, "Wrong Password"),
                detail: formatAuthMessage(t, "auth.error.wrongPassword.detail", {}, "The password you entered doesn't match our records."),
                hint: formatAuthMessage(t, "auth.error.wrongPassword.hint", {}, "Double-check CAPS LOCK, or click \"Forgot Password?\" to reset it."),
                actionLabel: formatAuthMessage(t, "auth.error.wrongPassword.actionLabel", {}, "Reset my password"),
            };
        case "auth/invalid-credential":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.invalidCredential.title", {}, "Invalid Credentials"),
                detail: formatAuthMessage(t, "auth.error.invalidCredential.detail", {}, "Email or password is incorrect."),
                hint: formatAuthMessage(t, "auth.error.invalidCredential.hint", {}, "Make sure you're using the email you registered with. Try \"Forgot Password?\" if you're stuck."),
                actionLabel: formatAuthMessage(t, "auth.error.invalidCredential.actionLabel", {}, "Reset my password"),
            };
        case "auth/user-not-found":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.userNotFound.title", {}, "Unable to Sign In"),
                detail: formatAuthMessage(t, "auth.error.userNotFound.detail", {}, "We could not verify those account details."),
                hint: formatAuthMessage(t, "auth.error.userNotFound.hint", {}, "Check your credentials and try again, or use \"Forgot Password?\" for help."),
                actionLabel: formatAuthMessage(t, "auth.error.userNotFound.actionLabel", {}, "Get sign-in help"),
            };
        case "auth/email-already-in-use":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.emailAlreadyInUse.title", {}, "Email Already Registered"),
                detail: formatAuthMessage(t, "auth.error.emailAlreadyInUse.detail", {}, "An account already exists with this email."),
                hint: formatAuthMessage(t, "auth.error.emailAlreadyInUse.hint", {}, "Sign in instead, or use \"Forgot Password?\" if you've lost access."),
                actionLabel: formatAuthMessage(t, "auth.error.emailAlreadyInUse.actionLabel", {}, "Sign in instead"),
            };
        case "auth/too-many-requests":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.tooManyRequests.title", {}, "Too Many Attempts"),
                detail: formatAuthMessage(t, "auth.error.tooManyRequests.detail", {}, "Your account has been temporarily locked due to too many failed sign-in attempts."),
                hint: formatAuthMessage(t, "auth.error.tooManyRequests.hint", {}, "Wait a few minutes and try again, or reset your password to regain access immediately."),
                actionLabel: formatAuthMessage(t, "auth.error.tooManyRequests.actionLabel", {}, "Reset & unlock my account"),
            };
        case "too many password reset attempts":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.tooManyPasswordResetAttempts.title", {}, "Too Many Reset Attempts"),
                detail: formatAuthMessage(t, "auth.error.tooManyPasswordResetAttempts.detail", {}, "This password reset was tried too many times."),
                hint: formatAuthMessage(t, "auth.error.tooManyPasswordResetAttempts.hint", {}, "Wait a few minutes, then request a fresh OTP before resetting your password again."),
                actionLabel: formatAuthMessage(t, "auth.error.tooManyPasswordResetAttempts.actionLabel", {}, "Start over"),
            };
        case "too many requests for this route":
        case "TRAFFIC_BUDGET_DENIED":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.securityFlowRateLimited.title", {}, "Too Many Requests"),
                detail: formatAuthMessage(t, "auth.error.securityFlowRateLimited.detail", {}, "This security flow was temporarily rate limited."),
                hint: formatAuthMessage(t, "auth.error.securityFlowRateLimited.hint", {}, "Wait a few minutes, then start the recovery flow again."),
                actionLabel: formatAuthMessage(t, "auth.error.securityFlowRateLimited.actionLabel", {}, "Start over"),
            };
        case "auth/network-request-failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.networkRequestFailed.title", {}, "Connection Problem"),
                detail: formatAuthMessage(t, "auth.error.networkRequestFailed.detail", {}, "We couldn't reach our authentication servers."),
                hint: formatAuthMessage(t, "auth.error.networkRequestFailed.hint", {}, "Check your internet connection and try again."),
            };
        case "auth/popup-closed-by-user":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.popupClosedByUser.title", {}, "Sign-In Cancelled"),
                detail: formatAuthMessage(t, "auth.error.popupClosedByUser.detail", {}, "The social sign-in window was closed before completing."),
                hint: formatAuthMessage(t, "auth.error.popupClosedByUser.hint", {}, "Open the provider window again and complete the sign-in flow."),
            };
        case "auth/account-exists-with-different-credential":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.accountExistsWithDifferentCredential.title", {}, "Account Already Exists"),
                detail: formatAuthMessage(t, "auth.error.accountExistsWithDifferentCredential.detail", {}, "This email is already linked to a different sign-in method."),
                hint: formatAuthMessage(t, "auth.error.accountExistsWithDifferentCredential.hint", {}, "Sign in with the existing method for this email, then link the new provider later."),
                actionLabel: formatAuthMessage(t, "auth.error.accountExistsWithDifferentCredential.actionLabel", {}, "Sign in with existing method"),
            };
        case "auth/social-invalid-credential":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.socialInvalidCredential.title", {}, "Social Sign-In Failed"),
                detail: formatAuthMessage(t, "auth.error.socialInvalidCredential.detail", {}, "We could not complete social authentication for this app."),
                hint: formatAuthMessage(t, "auth.error.socialInvalidCredential.hint", {}, "Check the OAuth provider configuration in Firebase and try again."),
            };
        case "auth/social-email-missing":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.socialEmailMissing.title", {}, "Social Email Access Required"),
                detail: formatAuthMessage(t, "auth.error.socialEmailMissing.detail", {}, "The social provider did not return an email address for this account."),
                hint: formatAuthMessage(t, "auth.error.socialEmailMissing.hint", {}, "Use a provider account that exposes an email address, or continue with email and OTP sign-in."),
            };
        case "auth/social-session-sync-failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.socialSessionSyncFailed.title", {}, "Social Sign-In Needs Retry"),
                detail: formatAuthMessage(t, "auth.error.socialSessionSyncFailed.detail", {}, "The social provider authenticated, but Aura could not finish opening your marketplace session."),
                hint: formatAuthMessage(t, "auth.error.socialSessionSyncFailed.hint", {}, "Try again once. If it repeats, use email and OTP sign-in while support checks the session sync service."),
            };
        case "auth/unauthorized-domain":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.unauthorizedDomain.title", {}, "Domain Not Authorized"),
                detail: formatAuthMessage(t, "auth.error.unauthorizedDomain.detail", {}, "This app URL is not allowed in Firebase Authentication."),
                hint: formatAuthMessage(t, "auth.error.unauthorizedDomain.hint", {}, "Add the active site domain in Firebase Authentication > Settings > Authorized domains, then retry social sign-in. Email and OTP sign-in remain available immediately."),
            };
        case "illegal url for new iframe":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.illegalUrlForNewIframe.title", {}, "Domain Not Authorized"),
                detail: formatAuthMessage(t, "auth.error.illegalUrlForNewIframe.detail", {}, "Firebase rejected the current site host for popup-based sign-in."),
                hint: formatAuthMessage(t, "auth.error.illegalUrlForNewIframe.hint", {}, "Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in."),
            };
        case "auth/social-auth-disabled":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.socialAuthDisabled.title", {}, "Social Sign-In Disabled"),
                detail: formatAuthMessage(t, "auth.error.socialAuthDisabled.detail", {}, "Google, Facebook, GitHub, X, Microsoft, and Apple sign-in are disabled by deployment configuration."),
                hint: formatAuthMessage(t, "auth.error.socialAuthDisabled.hint", {}, "Use email and OTP sign-in for now, or enable social sign-in in the frontend deployment settings."),
            };
        case "auth/native-social-auth-configuration-missing":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.nativeSocialAuthConfigurationMissing.title", {}, "Mobile Social Sign-In Not Ready"),
                detail: formatAuthMessage(t, "auth.error.nativeSocialAuthConfigurationMissing.detail", {}, "The installed app needs native Android/iOS OAuth credentials before Google, Facebook, GitHub, X, Microsoft, or Apple can complete sign-in."),
                hint: formatAuthMessage(t, "auth.error.nativeSocialAuthConfigurationMissing.hint", {}, "Use email and OTP sign-in in the app for now. Native social sign-in can be enabled after the Firebase mobile app config and provider credentials are attached to the release build."),
            };
        case "auth/configuration-unavailable":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.configurationUnavailable.title", {}, "Authentication Not Configured"),
                detail: formatAuthMessage(t, "auth.error.configurationUnavailable.detail", {}, "Firebase authentication is not configured correctly for this deployment."),
                hint: formatAuthMessage(t, "auth.error.configurationUnavailable.hint", {}, "The site can still load, but sign-in features will stay unavailable until the Firebase web config is fixed."),
            };
        case "auth/invalid-api-key":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.invalidApiKey.title", {}, "Authentication Misconfigured"),
                detail: formatAuthMessage(t, "auth.error.invalidApiKey.detail", {}, "The deployed Firebase API key is invalid for this frontend."),
                hint: formatAuthMessage(t, "auth.error.invalidApiKey.hint", {}, "Fix the Firebase web app configuration for this deployed domain, then redeploy the frontend."),
            };
        case "auth/billing-not-enabled":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.billingNotEnabled.title", {}, "Phone Verification Provider Unavailable"),
                detail: formatAuthMessage(t, "auth.error.billingNotEnabled.detail", {}, "Firebase phone verification is not enabled for this project billing setup."),
                hint: formatAuthMessage(t, "auth.error.billingNotEnabled.hint", {}, "Use the secure backup OTP route for now, or enable Firebase billing for phone authentication in the project console."),
            };
        case "auth/operation-not-allowed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.operationNotAllowed.title", {}, "Phone Verification Disabled"),
                detail: formatAuthMessage(t, "auth.error.operationNotAllowed.detail", {}, "Firebase phone authentication is disabled for this project."),
                hint: formatAuthMessage(t, "auth.error.operationNotAllowed.hint", {}, "Enable Phone as a Firebase sign-in provider, or continue with the secure backup OTP route."),
            };
        case "auth/invalid-app-credential":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.invalidAppCredential.title", {}, "Phone Verification Blocked"),
                detail: formatAuthMessage(t, "auth.error.invalidAppCredential.detail", {}, "Firebase could not initialize the secure phone verification challenge."),
                hint: formatAuthMessage(t, "auth.error.invalidAppCredential.hint", {}, "Retry once. If it still fails, the app can fall back to the secure backup OTP path."),
            };
        case "auth/missing-app-credential":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.missingAppCredential.title", {}, "Phone Verification Unavailable"),
                detail: formatAuthMessage(t, "auth.error.missingAppCredential.detail", {}, "The browser challenge for Firebase phone verification did not complete."),
                hint: formatAuthMessage(t, "auth.error.missingAppCredential.hint", {}, "Retry once, then refresh if the challenge keeps failing."),
            };
        case "auth/captcha-check-failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.captchaCheckFailed.title", {}, "Security Check Failed"),
                detail: formatAuthMessage(t, "auth.error.captchaCheckFailed.detail", {}, "The Firebase phone verification challenge did not validate cleanly."),
                hint: formatAuthMessage(t, "auth.error.captchaCheckFailed.hint", {}, "Retry the challenge and make sure browser protections are not blocking reCAPTCHA."),
            };
        case "auth/invalid-verification-code":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.invalidVerificationCode.title", {}, "Incorrect Code"),
                detail: formatAuthMessage(t, "auth.error.invalidVerificationCode.detail", {}, "That phone verification code is not valid."),
                hint: formatAuthMessage(t, "auth.error.invalidVerificationCode.hint", {}, "Re-enter the latest 6-digit code, or request a fresh one."),
            };
        case "auth/code-expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.codeExpired.title", {}, "Code Expired"),
                detail: formatAuthMessage(t, "auth.error.codeExpired.detail", {}, "That phone verification code is no longer valid."),
                hint: formatAuthMessage(t, "auth.error.codeExpired.hint", {}, "Request a fresh code and try again."),
                actionLabel: formatAuthMessage(t, "auth.error.codeExpired.actionLabel", {}, "Send a new code"),
            };
        case "auth/quota-exceeded":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.quotaExceeded.title", {}, "Too Many OTP Requests"),
                detail: formatAuthMessage(t, "auth.error.quotaExceeded.detail", {}, "Firebase temporarily throttled phone verification requests for this project."),
                hint: formatAuthMessage(t, "auth.error.quotaExceeded.hint", {}, "Wait a bit before retrying, or use the secure backup OTP route if it appears."),
            };
        case "auth/phone-mismatch":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.phoneMismatch.title", {}, "Registered Phone Mismatch"),
                detail: formatAuthMessage(t, "auth.error.phoneMismatch.detail", {}, "The phone number you entered does not match the phone already linked to this account."),
                hint: formatAuthMessage(t, "auth.error.phoneMismatch.hint", {}, "Use your registered phone number for login, or contact support if the account needs recovery."),
            };
        case "firebase phone verification is required":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.firebasePhoneVerificationIsRequired.title", {}, "Phone Verification Required"),
                detail: formatAuthMessage(t, "auth.error.firebasePhoneVerificationIsRequired.detail", {}, "Firebase phone verification must finish before the login can be completed."),
                hint: formatAuthMessage(t, "auth.error.firebasePhoneVerificationIsRequired.hint", {}, "Request a fresh code and finish the phone step before signing in again."),
            };
        case "verified phone number does not match":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.verifiedPhoneNumberDoesNotMatch.title", {}, "Verified Phone Mismatch"),
                detail: formatAuthMessage(t, "auth.error.verifiedPhoneNumberDoesNotMatch.detail", {}, "The verified Firebase phone number does not match the phone entered for this login."),
                hint: formatAuthMessage(t, "auth.error.verifiedPhoneNumberDoesNotMatch.hint", {}, "Use the registered phone number tied to this account and try again."),
            };
        case "phone number does not match your registered account":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.title", {}, "Registered Phone Mismatch"),
                detail: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.detail", {}, "The verified phone number does not match the account record."),
                hint: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourRegisteredAccount.hint", {}, "Use the phone number already registered on the account, or contact support for recovery."),
            };
        case "email address does not match your registered account":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.title", {}, "Registered Email Mismatch"),
                detail: formatAuthMessage(t, "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.detail", {}, "The email address does not match the account record for this phone number."),
                hint: formatAuthMessage(t, "auth.error.emailAddressDoesNotMatchYourRegisteredAccount.hint", {}, "Use the same email address that was used when this account was created."),
            };
        case "email otp verification is required before completing phone factor login":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.title", {}, "Email Verification Required"),
                detail: formatAuthMessage(t, "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.detail", {}, "Finish the email OTP step before completing phone verification."),
                hint: formatAuthMessage(t, "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.hint", {}, "Start the secure sign-in flow again and enter the email code first."),
                actionLabel: formatAuthMessage(t, "auth.error.emailOtpVerificationIsRequiredBeforeCompletingPhoneFactorLogin.actionLabel", {}, "Start over"),
            };
        case "email otp verification expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.emailOtpVerificationExpired.title", {}, "Email Code Expired"),
                detail: formatAuthMessage(t, "auth.error.emailOtpVerificationExpired.detail", {}, "The verified email step has expired for this login attempt."),
                hint: formatAuthMessage(t, "auth.error.emailOtpVerificationExpired.hint", {}, "Request fresh login codes to your email and phone, then try again."),
                actionLabel: formatAuthMessage(t, "auth.error.emailOtpVerificationExpired.actionLabel", {}, "Start over"),
            };
        case "signup email verification is required before completing phone verification":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title", {}, "Email Verification Required"),
                detail: formatAuthMessage(t, "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail", {}, "Finish the signup email OTP step before completing phone verification."),
                hint: formatAuthMessage(t, "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint", {}, "Start the signup verification flow again and enter the email code first."),
                actionLabel: formatAuthMessage(t, "auth.error.signupEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel", {}, "Start over"),
            };
        case "signup email verification expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.signupEmailVerificationExpired.title", {}, "Signup Verification Expired"),
                detail: formatAuthMessage(t, "auth.error.signupEmailVerificationExpired.detail", {}, "Your verified signup email step has expired."),
                hint: formatAuthMessage(t, "auth.error.signupEmailVerificationExpired.hint", {}, "Request fresh signup codes to your email and phone, then try again."),
                actionLabel: formatAuthMessage(t, "auth.error.signupEmailVerificationExpired.actionLabel", {}, "Start over"),
            };
        case "password recovery email verification is required before completing phone verification":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.title", {}, "Recovery Email Verification Required"),
                detail: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.detail", {}, "Finish the recovery email OTP step before completing phone verification."),
                hint: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.hint", {}, "Start the recovery flow again and enter the email code first."),
                actionLabel: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationIsRequiredBeforeCompletingPhoneVerification.actionLabel", {}, "Start over"),
            };
        case "password recovery email verification expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationExpired.title", {}, "Recovery Verification Expired"),
                detail: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationExpired.detail", {}, "Your verified recovery email step has expired."),
                hint: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationExpired.hint", {}, "Request fresh recovery codes to your email and phone, then try again."),
                actionLabel: formatAuthMessage(t, "auth.error.passwordRecoveryEmailVerificationExpired.actionLabel", {}, "Start over"),
            };
        case "password reset verification is required before setting a new password":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.title", {}, "Reset Verification Required"),
                detail: formatAuthMessage(t, "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.detail", {}, "Verify the recovery OTP before choosing a new password."),
                hint: formatAuthMessage(t, "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.hint", {}, "Start the forgot-password flow again and complete the OTP step first."),
                actionLabel: formatAuthMessage(t, "auth.error.passwordResetVerificationIsRequiredBeforeSettingANewPassword.actionLabel", {}, "Start over"),
            };
        case "password reset verification expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordResetVerificationExpired.title", {}, "Recovery Session Expired"),
                detail: formatAuthMessage(t, "auth.error.passwordResetVerificationExpired.detail", {}, "Your verified recovery session has expired."),
                hint: formatAuthMessage(t, "auth.error.passwordResetVerificationExpired.hint", {}, "Request a fresh OTP to your registered email and phone, then try again."),
                actionLabel: formatAuthMessage(t, "auth.error.passwordResetVerificationExpired.actionLabel", {}, "Start over"),
            };
        case "password reset account is not ready":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordResetAccountIsNotReady.title", {}, "Account Recovery Unavailable"),
                detail: formatAuthMessage(t, "auth.error.passwordResetAccountIsNotReady.detail", {}, "We could not find a password-auth account ready for reset."),
                hint: formatAuthMessage(t, "auth.error.passwordResetAccountIsNotReady.hint", {}, "Contact support if this account was created recently or was migrated from another sign-in method."),
            };
        case "unable to update password right now":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.unableToUpdatePasswordRightNow.title", {}, "Password Update Failed"),
                detail: formatAuthMessage(t, "auth.error.unableToUpdatePasswordRightNow.detail", {}, "We could not finish updating your password right now."),
                hint: formatAuthMessage(t, "auth.error.unableToUpdatePasswordRightNow.hint", {}, "Please try again in a moment. If this continues, contact support."),
            };
        case "password contains sequential characters":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordContainsSequentialCharacters.title", {}, "Password Too Predictable"),
                detail: formatAuthMessage(t, "auth.error.passwordContainsSequentialCharacters.detail", {}, "Your new password contains an easy-to-guess sequence."),
                hint: formatAuthMessage(t, "auth.error.passwordContainsSequentialCharacters.hint", {}, "Avoid patterns like 123, abc, or similar runs of characters."),
            };
        case "password contains repeated characters":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordContainsRepeatedCharacters.title", {}, "Password Too Predictable"),
                detail: formatAuthMessage(t, "auth.error.passwordContainsRepeatedCharacters.detail", {}, "Your new password repeats the same character too many times."),
                hint: formatAuthMessage(t, "auth.error.passwordContainsRepeatedCharacters.hint", {}, "Use a more varied password with mixed words, numbers, and symbols."),
            };
        case "password contains common date patterns":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordContainsCommonDatePatterns.title", {}, "Password Too Predictable"),
                detail: formatAuthMessage(t, "auth.error.passwordContainsCommonDatePatterns.detail", {}, "Your new password contains a common date-like pattern."),
                hint: formatAuthMessage(t, "auth.error.passwordContainsCommonDatePatterns.hint", {}, "Avoid birthdays, years, and obvious numeric sequences."),
            };
        case "password follows keyboard patterns":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordFollowsKeyboardPatterns.title", {}, "Password Too Predictable"),
                detail: formatAuthMessage(t, "auth.error.passwordFollowsKeyboardPatterns.detail", {}, "Your new password follows an easy keyboard pattern."),
                hint: formatAuthMessage(t, "auth.error.passwordFollowsKeyboardPatterns.hint", {}, "Avoid patterns like qwerty, asdf, or similar keyboard runs."),
            };
        case "phone number does not match your pending signup":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourPendingSignup.title", {}, "Pending Signup Mismatch"),
                detail: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourPendingSignup.detail", {}, "The verified phone number does not match the phone entered for this signup."),
                hint: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourPendingSignup.hint", {}, "Use the same phone number you entered when you started the signup flow."),
                actionLabel: formatAuthMessage(t, "auth.error.phoneNumberDoesNotMatchYourPendingSignup.actionLabel", {}, "Start over"),
            };
        case "you are already signed in":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.youAreAlreadySignedIn.title", {}, "Already Signed In"),
                detail: formatAuthMessage(t, "auth.error.youAreAlreadySignedIn.detail", {}, "This browser session is already authenticated."),
                hint: formatAuthMessage(t, "auth.error.youAreAlreadySignedIn.hint", {}, "Log out first if you want to create a different account."),
            };
        case "no verified account found for this email and phone number":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.title", {}, "Account Not Ready"),
                detail: formatAuthMessage(t, "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.detail", {}, "We could not find a verified account matching this email and phone number."),
                hint: formatAuthMessage(t, "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.hint", {}, "Create your account first, then sign in with the same email, phone, and password."),
                actionLabel: formatAuthMessage(t, "auth.error.noVerifiedAccountFoundForThisEmailAndPhoneNumber.actionLabel", {}, "Sign up"),
            };
        case "no account found with this phone":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.noAccountFoundWithThisPhone.title", {}, "Verification Required"),
                detail: formatAuthMessage(t, "auth.error.noAccountFoundWithThisPhone.detail", {}, "We could not verify those account details for OTP."),
                hint: formatAuthMessage(t, "auth.error.noAccountFoundWithThisPhone.hint", {}, "Recheck your email and phone details, then request a new code."),
            };
        case "no account found with this email":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.noAccountFoundWithThisEmail.title", {}, "Verification Required"),
                detail: formatAuthMessage(t, "auth.error.noAccountFoundWithThisEmail.detail", {}, "We could not verify those account details for OTP."),
                hint: formatAuthMessage(t, "auth.error.noAccountFoundWithThisEmail.hint", {}, "Recheck your email and phone details, then request a new code."),
            };
        case "no account found":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.noAccountFound.title", {}, "Verification Required"),
                detail: formatAuthMessage(t, "auth.error.noAccountFound.detail", {}, "We could not verify those account details for OTP."),
                hint: formatAuthMessage(t, "auth.error.noAccountFound.hint", {}, "Recheck your email and phone details, then request a new code."),
            };
        case "account with this email already exists":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.accountWithThisEmailAlreadyExists.title", {}, "Email Already Registered"),
                detail: formatAuthMessage(t, "auth.error.accountWithThisEmailAlreadyExists.detail", {}, "An account already exists with this email address."),
                hint: formatAuthMessage(t, "auth.error.accountWithThisEmailAlreadyExists.hint", {}, "Sign in to your existing account instead."),
                actionLabel: formatAuthMessage(t, "auth.error.accountWithThisEmailAlreadyExists.actionLabel", {}, "Sign in to my account"),
            };
        case "account with this phone number already exists":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.accountWithThisPhoneNumberAlreadyExists.title", {}, "Phone Already Registered"),
                detail: formatAuthMessage(t, "auth.error.accountWithThisPhoneNumberAlreadyExists.detail", {}, "An account with this phone number already exists."),
                hint: formatAuthMessage(t, "auth.error.accountWithThisPhoneNumberAlreadyExists.hint", {}, "Sign in using the email associated with this phone number."),
                actionLabel: formatAuthMessage(t, "auth.error.accountWithThisPhoneNumberAlreadyExists.actionLabel", {}, "Sign in to my account"),
            };
        case "invalid otp":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.invalidOtp.title", {}, "Incorrect Code"),
                detail: formatAuthMessage(t, "auth.error.invalidOtp.detail", {}, "The 6-digit code you entered doesn't match what we sent."),
                hint: formatAuthMessage(t, "auth.error.invalidOtp.hint", {}, "Check the email we sent — the code is exactly 6 digits. No spaces."),
            };
        case "otp has expired":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.otpHasExpired.title", {}, "Code Expired"),
                detail: formatAuthMessage(t, "auth.error.otpHasExpired.detail", {}, "Your verification code has expired (codes are valid for 5 minutes)."),
                hint: formatAuthMessage(t, "auth.error.otpHasExpired.hint", {}, "Click \"Resend OTP\" below to get a fresh code."),
                actionLabel: formatAuthMessage(t, "auth.error.otpHasExpired.actionLabel", {}, "Send a new code"),
            };
        case "otp purpose mismatch":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.otpPurposeMismatch.title", {}, "Session Mismatch"),
                detail: formatAuthMessage(t, "auth.error.otpPurposeMismatch.detail", {}, "Something went wrong with your verification session."),
                hint: formatAuthMessage(t, "auth.error.otpPurposeMismatch.hint", {}, "Go back and start the process again from the beginning."),
                actionLabel: formatAuthMessage(t, "auth.error.otpPurposeMismatch.actionLabel", {}, "Start over"),
            };
        case "phone number is required":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.phoneNumberIsRequired.title", {}, "Phone Number Missing"),
                detail: formatAuthMessage(t, "auth.error.phoneNumberIsRequired.detail", {}, "Please enter your registered phone number."),
                hint: formatAuthMessage(t, "auth.error.phoneNumberIsRequired.hint", {}, "Include the country code, e.g. +91 98765 43210"),
            };
        case "enter complete 6-digit otp":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.enterComplete6DigitOtp.title", {}, "Incomplete Code"),
                detail: formatAuthMessage(t, "auth.error.enterComplete6DigitOtp.detail", {}, "Please fill in all 6 digits of your verification code."),
                hint: formatAuthMessage(t, "auth.error.enterComplete6DigitOtp.hint", {}, "Check your email inbox for the code. Look in your Spam folder too!"),
            };
        case "too many failed attempts":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.tooManyFailedAttempts.title", {}, "Account Temporarily Locked"),
                detail: formatAuthMessage(t, "auth.error.tooManyFailedAttempts.detail", {}, "Too many failed attempts. Security lock is now active."),
                hint: formatAuthMessage(t, "auth.error.tooManyFailedAttempts.hint", {}, "Wait 15 minutes, or reset your password to unlock immediately."),
                actionLabel: formatAuthMessage(t, "auth.error.tooManyFailedAttempts.actionLabel", {}, "Reset password to unlock"),
            };
        case "password must be at least 6":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordMustBeAtLeast6.title", {}, "Password Too Short"),
                detail: formatAuthMessage(t, "auth.error.passwordMustBeAtLeast6.detail", {}, "Your password must be at least 6 characters long."),
                hint: formatAuthMessage(t, "auth.error.passwordMustBeAtLeast6.hint", {}, "Use a mix of letters, numbers, and symbols for a strong password."),
            };
        case "passwords do not match":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.passwordsDoNotMatch.title", {}, "Passwords Don't Match"),
                detail: formatAuthMessage(t, "auth.error.passwordsDoNotMatch.detail", {}, "Your password and confirmation don't match."),
                hint: formatAuthMessage(t, "auth.error.passwordsDoNotMatch.hint", {}, "Re-type your password carefully in both fields."),
            };
        case "valid phone number is required":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.validPhoneNumberIsRequired.title", {}, "Invalid Phone Number"),
                detail: formatAuthMessage(t, "auth.error.validPhoneNumberIsRequired.detail", {}, "Please enter a valid phone number (10–15 digits)."),
                hint: formatAuthMessage(t, "auth.error.validPhoneNumberIsRequired.hint", {}, "Include the country code, e.g. +91 98765 43210"),
            };
        case "dpop jti replay detected":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.dpopJtiReplayDetected.title", {}, "Secure Sign-In Needs Retry"),
                detail: formatAuthMessage(t, "auth.error.dpopJtiReplayDetected.detail", {}, "Aura rejected a repeated browser proof while opening your session."),
                hint: formatAuthMessage(t, "auth.error.dpopJtiReplayDetected.hint", {}, "Refresh the page once and sign in again. Your password and OTP remain protected."),
                actionLabel: formatAuthMessage(t, "auth.error.dpopJtiReplayDetected.actionLabel", {}, "Try sign-in again"),
            };
        case "dpop verification failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.dpopVerificationFailed.title", {}, "Secure Sign-In Needs Retry"),
                detail: formatAuthMessage(t, "auth.error.dpopVerificationFailed.detail", {}, "Aura could not verify the browser proof for this sign-in attempt."),
                hint: formatAuthMessage(t, "auth.error.dpopVerificationFailed.hint", {}, "Refresh the page once and sign in again. If it repeats, clear this site session and retry."),
                actionLabel: formatAuthMessage(t, "auth.error.dpopVerificationFailed.actionLabel", {}, "Try sign-in again"),
            };
        case "google sign-in failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.googleSignInFailed.title", {}, "Google Sign-In Failed"),
                detail: formatAuthMessage(t, "auth.error.googleSignInFailed.detail", {}, "We couldn't complete Google authentication."),
                hint: formatAuthMessage(t, "auth.error.googleSignInFailed.hint", {}, "Try again, or sign in manually with your email and password."),
            };
        case "if account details are valid, verification will proceed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.ifAccountDetailsAreValidVerificationWillProceed.title", {}, "Verification In Progress"),
                detail: formatAuthMessage(t, "auth.error.ifAccountDetailsAreValidVerificationWillProceed.detail", {}, "If your account details are valid, we'll continue with verification."),
                hint: formatAuthMessage(t, "auth.error.ifAccountDetailsAreValidVerificationWillProceed.hint", {}, "Please recheck your email and phone number, then try again."),
            };
        case "failed to send otp":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.failedToSendOtp.title", {}, "Couldn't Send Code"),
                detail: formatAuthMessage(t, "auth.error.failedToSendOtp.detail", {}, "We had trouble sending your verification code."),
                hint: formatAuthMessage(t, "auth.error.failedToSendOtp.hint", {}, "Check your email address is correct and try again."),
            };
        case "temporarily suspended until":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.temporarilySuspendedUntil.title", {}, "Account Suspended"),
                detail: formatAuthMessage(t, "auth.error.temporarilySuspendedUntil.detail", {}, "Your account is currently suspended by the trust and safety team."),
                hint: formatAuthMessage(t, "auth.error.temporarilySuspendedUntil.hint", {}, "Please contact support to request a review."),
            };
        case "your account is not active":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.yourAccountIsNotActive.title", {}, "Account Disabled"),
                detail: formatAuthMessage(t, "auth.error.yourAccountIsNotActive.detail", {}, "This account is no longer active."),
                hint: formatAuthMessage(t, "auth.error.yourAccountIsNotActive.hint", {}, "Contact support for account recovery options."),
            };
        case "user profile missing from login database":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.userProfileMissingFromLoginDatabase.title", {}, "Session Recovery Required"),
                detail: formatAuthMessage(t, "auth.error.userProfileMissingFromLoginDatabase.detail", {}, "Your profile needs to be re-synced before continuing."),
                hint: formatAuthMessage(t, "auth.error.userProfileMissingFromLoginDatabase.hint", {}, "Sign out and sign in again to recover your account session."),
                actionLabel: formatAuthMessage(t, "auth.error.userProfileMissingFromLoginDatabase.actionLabel", {}, "Sign in again"),
            };
        case "csrf token fetch failed for /auth/sync: http 401":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.title", {}, "Session Expired"),
                detail: formatAuthMessage(t, "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.detail", {}, "This browser was holding an old sign-in token, so the secure session sync was rejected."),
                hint: formatAuthMessage(t, "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.hint", {}, "Your stale session has been cleared. Sign in again to continue."),
                actionLabel: formatAuthMessage(t, "auth.error.csrfTokenFetchFailedForAuthSyncHttp401.actionLabel", {}, "Sign in again"),
            };
        case "not authorized, token failed":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.notAuthorizedTokenFailed.title", {}, "Session Expired"),
                detail: formatAuthMessage(t, "auth.error.notAuthorizedTokenFailed.detail", {}, "Your sign-in token is no longer valid for secure account access."),
                hint: formatAuthMessage(t, "auth.error.notAuthorizedTokenFailed.hint", {}, "Sign in again to refresh your secure session."),
                actionLabel: formatAuthMessage(t, "auth.error.notAuthorizedTokenFailed.actionLabel", {}, "Sign in again"),
            };
        case "default":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.error.default.title", {}, "Something Went Wrong"),
                detail: formatAuthMessage(t, "auth.error.default.detail", {}, "An unexpected error occurred during sign-in."),
                hint: formatAuthMessage(t, "auth.error.default.hint", {}, "Please try again. If this continues, contact support."),
            };
        default:
            return fallback;
    }
};

const localizeStaticAuthSuccess = (key, fallback, t) => {
    if (typeof t !== 'function' || !fallback) return fallback;

    switch (key) {
        case "otp_sent":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.otpSent.title", {}, "Code Sent!"),
                detail: formatAuthMessage(t, "auth.success.otpSent.detail", {}, "If the account details are valid, a 6-digit verification code has been sent."),
            };
        case "otp_resent":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.otpResent.title", {}, "New Code Sent!"),
                detail: formatAuthMessage(t, "auth.success.otpResent.detail", {}, "If the account details are valid, a fresh verification code has been sent."),
            };
        case "otp_verified":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.otpVerified.title", {}, "Verified!"),
                detail: formatAuthMessage(t, "auth.success.otpVerified.detail", {}, "Your identity has been confirmed."),
            };
        case "signin_success":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.signinSuccess.title", {}, "Welcome Back!"),
                detail: formatAuthMessage(t, "auth.success.signinSuccess.detail", {}, "You're now signed in. Redirecting..."),
            };
        case "signup_success":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.signupSuccess.title", {}, "Account Created!"),
                detail: formatAuthMessage(t, "auth.success.signupSuccess.detail", {}, "Welcome to AURA! Setting up your account..."),
            };
        case "reset_sent":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.resetSent.title", {}, "Reset Email Sent!"),
                detail: formatAuthMessage(t, "auth.success.resetSent.detail", {}, "Check your inbox for a password reset link."),
            };
        case "password_reset_success":
            return {
                ...fallback,
                title: formatAuthMessage(t, "auth.success.passwordResetSuccess.title", {}, "Password Updated!"),
                detail: formatAuthMessage(t, "auth.success.passwordResetSuccess.detail", {}, "Your password was changed successfully. Sign in with the new password now."),
            };
        default:
            return fallback;
    }
};

export const resolveAuthSuccess = (key, t) => localizeStaticAuthSuccess(key, AUTH_SUCCESS[key], t);

const extractAuthErrorDetail = (value) => {
    if (!value) return '';

    if (typeof value === 'string') {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => extractAuthErrorDetail(entry))
            .filter(Boolean)
            .join(', ');
    }

    if (typeof value === 'object') {
        if (typeof value.message === 'string' && value.message.trim()) {
            return value.message.trim();
        }

        if (typeof value.detail === 'string' && value.detail.trim()) {
            return value.detail.trim();
        }

        if (Array.isArray(value.errors) && value.errors.length > 0) {
            const combined = value.errors
                .map((issue) => extractAuthErrorDetail(issue))
                .filter(Boolean)
                .join(', ');
            if (combined) {
                return combined;
            }
        }
    }

    return '';
};

/**
 * Resolve a raw error (code or message string) into a structured AUTH_ERROR object.
 * @param {string} rawError — Firebase error code OR backend message string
 * @returns {object} — { title, detail, hint, action, actionLabel }
 */
export const resolveAuthError = (rawError, t) => {
    if (!rawError) return localizeStaticAuthError('default', AUTH_ERRORS['default'], t);

    const primaryErrorValue = (
        rawError?.code
        ?? rawError?.message
        ?? rawError?.data?.message
        ?? rawError
        ?? ''
    );
    const errorStr = String(primaryErrorValue).toLowerCase();

    if (rawError?.code === 'auth/social-invalid-credential') {
        return buildSocialInvalidCredentialError(rawError, t);
    }

    if (
        rawError?.code === 'auth/invalid-credential'
        && (rawError?.provider || rawError?.providerId || rawError?.customData?.providerId)
    ) {
        return buildSocialInvalidCredentialError(rawError, t);
    }

    if (rawError?.code === 'auth/account-exists-with-different-credential') {
        return buildAccountExistsWithDifferentCredentialError(rawError, t);
    }

    if (
        rawError?.code === 'auth/social-email-missing'
        || errorStr.includes('did not provide an email')
        || errorStr.includes('authenticated account is missing email')
    ) {
        return buildSocialMissingEmailError(rawError, t);
    }

    if (
        rawError?.code === 'auth/social-session-sync-failed'
        || (
            (rawError?.provider || rawError?.providerId || rawError?.customData?.providerId)
            && Number(rawError?.status || rawError?.data?.statusCode || 0) >= 500
            && (
                errorStr.includes('something went wrong')
                || errorStr.includes('request failed with status 500')
            )
        )
    ) {
        return buildSocialSessionSyncError(rawError, t);
    }

    if (rawError?.code === 'auth/unauthorized-domain') {
        return buildUnauthorizedDomainError(rawError, t);
    }

    if (errorStr.includes('illegal url for new iframe')) {
        return buildIllegalIframeError(rawError, t);
    }

    // Try exact Firebase code match first
    if (rawError.code && AUTH_ERRORS[rawError.code]) {
        return localizeStaticAuthError(rawError.code, AUTH_ERRORS[rawError.code], t);
    }

    // Try substring match against message
    for (const [key, value] of Object.entries(AUTH_ERRORS)) {
        if (key === 'default') continue;
        if (errorStr.includes(key)) return localizeStaticAuthError(key, value, t);
    }

    const fallbackDetail = (
        extractAuthErrorDetail(rawError?.message)
        || extractAuthErrorDetail(rawError?.detail)
        || extractAuthErrorDetail(rawError?.data)
        || (typeof rawError === 'string' ? rawError.trim() : '')
    );
    return {
        ...localizeStaticAuthError('default', AUTH_ERRORS['default'], t),
        ...(fallbackDetail ? { detail: fallbackDetail } : {}),
    };
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
