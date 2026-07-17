const normalize = (value) => String(value || '').trim().toLowerCase();

// Before the overhaul, a successful ceremony stored only the requested UV
// policy. A historical `required` value is still trustworthy because the
// verifier rejected the ceremony when the UV flag was absent. New records
// persist the observed flag explicitly, and explicit false always wins.
const hasObservedWebAuthnUserVerification = (device = null) => {
    if (!device) return false;
    if (device.webauthnUserVerified === true) return true;
    if (device.webauthnUserVerified === false) return false;
    return normalize(device.webauthnUserVerification) === 'required';
};

module.exports = {
    hasObservedWebAuthnUserVerification,
};
