const ACRONYM_LABELS = {
    admin: 'Admin',
    api: 'API',
    bi: 'BI',
    csv: 'CSV',
    db: 'DB',
    fx: 'FX',
    http: 'HTTP',
    id: 'ID',
    otp: 'OTP',
    pii: 'PII',
    upi: 'UPI',
    url: 'URL',
};

const splitCamelCase = (value = '') => String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

export const normalizeEnumToken = (value = '') => splitCamelCase(value)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const humanizeEnumLabel = (value = '') => {
    const normalized = normalizeEnumToken(value);
    if (!normalized) return '';

    return normalized
        .split('_')
        .filter(Boolean)
        .map((part) => ACRONYM_LABELS[part] || `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
};

export const translateEnumLabel = (t, prefix, value, fallback = '') => {
    const normalized = normalizeEnumToken(value);
    if (!normalized) {
        return fallback || '';
    }

    return t(`${prefix}.${normalized}`, {}, fallback || humanizeEnumLabel(value));
};
