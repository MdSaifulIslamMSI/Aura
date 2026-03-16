/**
 * Password Security Validator
 * 
 * Enforces password policy on backend:
 * - Minimum 12 characters
 * - Requires uppercase letter (A-Z)
 * - Requires lowercase letter (a-z)
 * - Requires digit (0-9)
 * - Requires special character (!@#$%^&*)
 */

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SPECIAL_CHARS = /[!@#$%^&*]/;
const PASSWORD_UPPERCASE = /[A-Z]/;
const PASSWORD_LOWERCASE = /[a-z]/;
const PASSWORD_DIGIT = /[0-9]/;

/**
 * Validate password against security policy
 * @param {string} password - Password to validate
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
const validatePasswordPolicy = (password) => {
    const errors = [];

    if (!password || typeof password !== 'string') {
        errors.push('Password is required and must be a string');
        return { isValid: false, errors };
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
        errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long (currently ${password.length})`);
    }

    if (!PASSWORD_UPPERCASE.test(password)) {
        errors.push('Password must contain at least one uppercase letter (A-Z)');
    }

    if (!PASSWORD_LOWERCASE.test(password)) {
        errors.push('Password must contain at least one lowercase letter (a-z)');
    }

    if (!PASSWORD_DIGIT.test(password)) {
        errors.push('Password must contain at least one digit (0-9)');
    }

    if (!PASSWORD_SPECIAL_CHARS.test(password)) {
        errors.push('Password must contain at least one special character (!@#$%^&*)');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
};

/**
 * Check password against common weak patterns
 * @param {string} password - Password to check
 * @returns {Object} { isWeak: boolean, reason: string }
 */
const detectWeakPasswordPatterns = (password) => {
    if (!password || typeof password !== 'string') {
        return { isWeak: false, reason: null };
    }

    // Check for sequential patterns
    if (/012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|xyz/.test(password.toLowerCase())) {
        return { isWeak: true, reason: 'Password contains sequential characters' };
    }

    // Check for repeated patterns
    if (/(.)(?:\1{2,})/.test(password)) {
        return { isWeak: true, reason: 'Password contains repeated characters' };
    }

    // Check for simple date patterns
    if (/\d{4}[01]\d[0-3]\d|19[0-9]{2}|20[0-2][0-9]|2024|2025|2026/.test(password)) {
        return { isWeak: true, reason: 'Password contains common date patterns' };
    }

    // Check for keyboard patterns
    if (/qwerty|asdfgh|zxcvbn|qazwsx/.test(password.toLowerCase())) {
        return { isWeak: true, reason: 'Password follows keyboard patterns' };
    }

    return { isWeak: false, reason: null };
};

module.exports = {
    validatePasswordPolicy,
    detectWeakPasswordPatterns,
    PASSWORD_MIN_LENGTH,
    PASSWORD_SPECIAL_CHARS,
    PASSWORD_UPPERCASE,
    PASSWORD_LOWERCASE,
    PASSWORD_DIGIT,
};
