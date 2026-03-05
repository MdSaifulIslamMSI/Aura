const MARKETPLACE_SEED_MARKER = '[AURA_MARKETPLACE_SEED_V1]';
const MARKETPLACE_SEED_REGEX = /\[AURA_MARKETPLACE_SEED_V1\]/i;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_DATA_IMAGE_BYTES = Number(process.env.MARKETPLACE_MAX_IMAGE_BYTES || 1_500_000);
const ALLOWED_DATA_IMAGE_MIME = /^(image\/jpeg|image\/jpg|image\/png|image\/webp)$/i;

const DEMO_TEXT_PATTERNS = [
    MARKETPLACE_SEED_REGEX,
    /\b(?:demo|sample|dummy)\s+(?:listing|item|product)\b/i,
    /\btest\s+listing\b/i,
];

const BLOCKED_IMAGE_PATTERNS = [
    /cdn\.dummyjson\.com/i,
    /picsum\.photos/i,
    /via\.placeholder\.com/i,
    /placehold\.co/i,
    /loremflickr\.com/i,
    /placeholder/i,
];

const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeNumberInRange = (value, min, max) => {
    if (value === '' || value === null || value === undefined) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric < min || numeric > max) return null;
    return numeric;
};
const getDataUriPrefix = (value) => String(value || '').split(',', 1)[0] || '';
const estimateDataUriBytes = (value) => {
    const base64 = String(value || '').split(',', 2)[1] || '';
    return Math.ceil((base64.length * 3) / 4);
};
const isHttpsUrl = (value) => /^https:\/\/[^\s]+$/i.test(value);

const normalizeListingInput = (payload = {}) => ({
    title: normalizeText(payload.title),
    description: normalizeText(payload.description),
    price: Number(payload.price),
    negotiable: payload.negotiable !== false,
    condition: normalizeText(payload.condition),
    category: normalizeText(payload.category),
    images: Array.isArray(payload.images) ? payload.images.map((image) => String(image || '').trim()).filter(Boolean) : [],
    location: {
        city: normalizeText(payload.location?.city),
        state: normalizeText(payload.location?.state),
        pincode: normalizeText(payload.location?.pincode),
        latitude: normalizeNumberInRange(payload.location?.latitude, -90, 90),
        longitude: normalizeNumberInRange(payload.location?.longitude, -180, 180),
        accuracyMeters: normalizeNumberInRange(payload.location?.accuracyMeters, 0, 1_000_000),
        confidence: normalizeNumberInRange(payload.location?.confidence, 0, 100),
        provider: normalizeText(payload.location?.provider).slice(0, 80),
        capturedAt: (() => {
            const value = payload.location?.capturedAt;
            if (!value) return null;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        })(),
    },
});

const hasBlockedDemoText = ({ title = '', description = '' } = {}) => {
    const combined = `${title} ${description}`;
    return DEMO_TEXT_PATTERNS.some((pattern) => pattern.test(combined));
};

const isDataImage = (value) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);

const isRelativeImagePath = (value) => /^\/(uploads|images)\//i.test(value);

const getInvalidImageReason = (image) => {
    if (!image) {
        return 'Empty image value is not allowed.';
    }

    if (image.length > MAX_IMAGE_URL_LENGTH && !isDataImage(image)) {
        return 'Image URL is too long.';
    }

    if (isDataImage(image)) {
        const mime = (getDataUriPrefix(image).match(/^data:([^;]+);base64$/i) || [])[1] || '';
        if (!ALLOWED_DATA_IMAGE_MIME.test(mime)) {
            return 'Only JPG, PNG, or WEBP images are allowed.';
        }
        if (estimateDataUriBytes(image) > MAX_DATA_IMAGE_BYTES) {
            return 'Image is too large. Please upload a smaller photo.';
        }
        return null;
    }

    if (isRelativeImagePath(image)) {
        return null;
    }

    if (isHttpsUrl(image)) {
        return null;
    }

    return 'Image must be a valid HTTPS URL or uploaded image.';
};

const hasBlockedImageSource = (images = []) =>
    images.some((image) => {
        if (!image) return true;
        if (isDataImage(image) || isRelativeImagePath(image)) {
            return false;
        }
        return BLOCKED_IMAGE_PATTERNS.some((pattern) => pattern.test(image));
    });

const getIntegrityIssue = (listingInput) => {
    if (hasBlockedDemoText(listingInput)) {
        return 'Demo or sample listing text is not allowed in marketplace.';
    }

    const invalidImageReason = (listingInput.images || [])
        .map((image) => getInvalidImageReason(image))
        .find(Boolean);
    if (invalidImageReason) {
        return invalidImageReason;
    }

    if (hasBlockedImageSource(listingInput.images)) {
        return 'Demo or placeholder image sources are not allowed. Upload real product photos.';
    }
    return null;
};

const buildRealListingsFilter = (baseFilter = {}) => ({
    $and: [
        baseFilter,
        { source: { $ne: 'seed' } },
        { description: { $not: MARKETPLACE_SEED_REGEX } },
    ],
});

const isRealListingDoc = (listingDoc = {}) => {
    if (!listingDoc) return false;
    if (listingDoc.source === 'seed') return false;
    return !MARKETPLACE_SEED_REGEX.test(String(listingDoc.description || ''));
};

module.exports = {
    MARKETPLACE_SEED_MARKER,
    MARKETPLACE_SEED_REGEX,
    normalizeListingInput,
    getIntegrityIssue,
    buildRealListingsFilter,
    isRealListingDoc,
};
