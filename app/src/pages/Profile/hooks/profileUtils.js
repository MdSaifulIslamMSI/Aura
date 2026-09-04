export const PROFILE_FIELDS = ['name', 'phone', 'gender', 'dob', 'bio'];

export const PHONE_REGEX = /^\+?\d{10,15}$/;

export const normalizePhone = (phone) => String(phone || '').replace(/[\s\-()]/g, '').trim();
export const trimText = (value) => String(value || '').trim();
export const isNotFoundError = (error) => Number(error?.status) === 404 || /not found/i.test(String(error?.message || ''));

export const createEditForm = (source = {}) => ({
    name: source?.name || '',
    phone: source?.phone || '',
    gender: source?.gender || '',
    dob: source?.dob ? new Date(source.dob).toISOString().split('T')[0] : '',
    bio: source?.bio || '',
});

export const normalizeProfileFormForComparison = (value = {}) => ({
    name: trimText(value.name),
    phone: normalizePhone(value.phone),
    gender: trimText(value.gender),
    dob: trimText(value.dob),
    bio: trimText(value.bio),
});

export const areProfileFormsEqual = (left = {}, right = {}) => {
    const a = normalizeProfileFormForComparison(left);
    const b = normalizeProfileFormForComparison(right);
    return PROFILE_FIELDS.every((field) => a[field] === b[field]);
};

export const validateProfileForm = (value = {}, t) => {
    const errors = {};
    const normalized = normalizeProfileFormForComparison(value);
    if (normalized.name.length < 2 || normalized.name.length > 50) {
        errors.name = t('profile.personal.error.name', {}, 'Enter a name between 2 and 50 characters.');
    }
    if (normalized.phone && !PHONE_REGEX.test(normalized.phone)) {
        errors.phone = t('profile.personal.error.phone', {}, 'Enter a valid phone number with 10 to 15 digits.');
    }
    if (normalized.bio.length > 200) {
        errors.bio = t('profile.personal.error.bio', {}, 'Keep your bio to 200 characters or fewer.');
    }
    if (normalized.dob) {
        const date = new Date(normalized.dob);
        if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
            errors.dob = t('profile.personal.error.dob', {}, 'Enter a valid date of birth that is not in the future.');
        }
    }
    return errors;
};
