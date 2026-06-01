const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const CARD_LIKE_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const UPI_PATTERN = /\b[A-Z0-9._-]{2,}@[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:Bearer\s+)?(?:sk|pk|tok|api|key|secret)[A-Z0-9._-]{12,}\b/gi;
const OTP_PATTERN = /\b(?:otp|code|pin)\s*[:#-]?\s*\d{4,8}\b/gi;
const ORDER_ID_PATTERN = /\b(?:order|ord|txn|payment|pay)[-_:#\s]*[A-Z0-9-]{6,}\b/gi;

const REDACTION_RULES = [
    ['EMAIL', EMAIL_PATTERN],
    ['URL', URL_PATTERN],
    ['PHONE', PHONE_PATTERN],
    ['CARD', CARD_LIKE_PATTERN],
    ['UPI', UPI_PATTERN],
    ['TOKEN', TOKEN_PATTERN],
    ['OTP', OTP_PATTERN],
    ['ORDER_ID', ORDER_ID_PATTERN],
];

const redactTranslationText = (value = '') => {
    let redactedText = String(value || '');
    const replacements = [];

    REDACTION_RULES.forEach(([label, pattern]) => {
        redactedText = redactedText.replace(pattern, (match) => {
            const placeholder = `<${label}_${replacements.length + 1}>`;
            replacements.push({ placeholder, value: match });
            return placeholder;
        });
    });

    return {
        hasSensitiveData: replacements.length > 0,
        redactedText,
        replacements,
    };
};

const restoreTranslationText = (value = '', replacements = []) => {
    let restoredText = String(value || '');
    replacements.forEach(({ placeholder, value: originalValue }) => {
        restoredText = restoredText.split(placeholder).join(originalValue);
    });
    return restoredText;
};

module.exports = {
    redactTranslationText,
    restoreTranslationText,
};
