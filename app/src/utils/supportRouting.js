const safeString = (value = '') => String(value ?? '').trim();

export const buildSupportHandoffPath = (prefill = {}) => {
    const params = new URLSearchParams();
    params.set('compose', '1');

    if (safeString(prefill?.category)) params.set('category', safeString(prefill.category));
    if (safeString(prefill?.subject)) params.set('subject', safeString(prefill.subject));
    if (safeString(prefill?.intent)) params.set('intent', safeString(prefill.intent));
    if (safeString(prefill?.actionId)) params.set('actionId', safeString(prefill.actionId));

    return `/contact?${params.toString()}`;
};

export default buildSupportHandoffPath;
