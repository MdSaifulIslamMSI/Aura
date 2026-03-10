import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BadgeCheck,
    BookOpen,
    Camera,
    Car,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    Dumbbell,
    Gamepad2,
    Home as HomeIcon,
    ImagePlus,
    Laptop,
    Loader2,
    LocateFixed,
    MapPin,
    Package,
    ShieldCheck,
    Shirt,
    Smartphone,
    Sofa,
    Sparkles,
    Store,
    Tag,
    Wallet,
    X,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { useColorMode } from '@/context/ColorModeContext';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';
import { listingApi } from '@/services/api';
import { formatPrice } from '@/utils/format';
import { detectLocationFromGps } from '@/utils/geolocation';

const CATEGORIES = [
    { value: 'mobiles', label: 'Mobiles', subtitle: 'Phones, accessories, and flagship drops', icon: Smartphone, color: '#3b82f6' },
    { value: 'laptops', label: 'Laptops', subtitle: 'Workstations, ultrabooks, and rigs', icon: Laptop, color: '#8b5cf6' },
    { value: 'electronics', label: 'Electronics', subtitle: 'Audio, cameras, wearables, and more', icon: Package, color: '#06b6d4' },
    { value: 'vehicles', label: 'Vehicles', subtitle: 'Cars, bikes, and premium mobility', icon: Car, color: '#f59e0b' },
    { value: 'furniture', label: 'Furniture', subtitle: 'Home pieces with strong resale appeal', icon: Sofa, color: '#10b981' },
    { value: 'fashion', label: 'Fashion', subtitle: 'Designerwear, sneakers, and statement pieces', icon: Shirt, color: '#ec4899' },
    { value: 'books', label: 'Books', subtitle: 'Academic, collectible, and lifestyle shelves', icon: BookOpen, color: '#6366f1' },
    { value: 'sports', label: 'Sports', subtitle: 'Performance gear and fitness hardware', icon: Dumbbell, color: '#14b8a6' },
    { value: 'home-appliances', label: 'Home and Kitchen', subtitle: 'Trusted appliances and utility devices', icon: HomeIcon, color: '#f97316' },
    { value: 'gaming', label: 'Gaming', subtitle: 'Consoles, titles, and pro accessories', icon: Gamepad2, color: '#a855f7' },
    { value: 'other', label: 'Other', subtitle: 'Anything niche, collectible, or rare', icon: Tag, color: '#64748b' },
];

const CONDITIONS = [
    { value: 'new', label: 'Brand New', desc: 'Unused item with original packaging and accessories.' },
    { value: 'like-new', label: 'Like New', desc: 'Opened or lightly used, but still presentation-grade.' },
    { value: 'good', label: 'Good', desc: 'Clear signs of use with dependable performance.' },
    { value: 'fair', label: 'Fair', desc: 'Visible wear, priced honestly, fully functional.' },
];

const STEP_META = [
    {
        title: 'Choose your lane',
        kicker: 'Category',
        description: 'Start with the category buyers naturally browse so your listing lands in the right high-intent shelf.',
        icon: Tag,
    },
    {
        title: 'Shape the story',
        kicker: 'Details',
        description: 'Strong titles, credible pricing, and honest condition notes make a premium first impression.',
        icon: Sparkles,
    },
    {
        title: 'Stage the visuals',
        kicker: 'Photos',
        description: 'Clear photography builds trust, lifts click-through, and helps buyers understand condition fast.',
        icon: Camera,
    },
    {
        title: 'Pin the pickup zone',
        kicker: 'Location',
        description: 'Accurate location data improves buyer confidence and keeps local discovery sharp.',
        icon: MapPin,
    },
    {
        title: 'Approve the final cut',
        kicker: 'Review',
        description: 'Check the preview before publishing so the listing feels intentional from day one.',
        icon: CheckCircle2,
    },
];

const MAX_IMAGES = 5;
const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ENCODED_IMAGE_BYTES = 1_200_000;
const MAX_IMAGE_DIMENSION = 1600;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read selected image.'));
    reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Invalid image file.'));
    image.src = src;
});

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to encode image.'));
    reader.readAsDataURL(blob);
});

const estimateDataUriBytes = (value = '') => {
    const base64 = String(value).split(',', 2)[1] || '';
    return Math.ceil((base64.length * 3) / 4);
};

const hexToRgb = (hex) => {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!normalized) return { r: 6, g: 182, b: 212 };

    const safeHex = normalized.length === 3
        ? normalized.split('').map((value) => `${value}${value}`).join('')
        : normalized.padEnd(6, '0').slice(0, 6);

    const value = Number.parseInt(safeHex, 16);
    if (!Number.isFinite(value)) return { r: 6, g: 182, b: 212 };

    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
};

const toRgba = (hex, alpha) => {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const compressImageToWebp = async (file) => {
    const sourceDataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(sourceDataUrl);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Could not process image.');
    }

    context.drawImage(image, 0, 0, width, height);

    const qualities = [0.88, 0.8, 0.72, 0.64, 0.56];
    for (const quality of qualities) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob) continue;
        if (blob.size <= MAX_ENCODED_IMAGE_BYTES) {
            return blobToDataUrl(blob);
        }
    }

    throw new Error('Image is too large after compression. Choose a smaller photo.');
};

const studioChecklist = (form) => [
    { label: 'Category selected', ready: Boolean(form.category) },
    { label: 'Title and description ready', ready: form.title.trim().length >= 5 && form.description.trim().length >= 10 },
    { label: 'At least one real photo', ready: form.images.length >= 1 },
    { label: 'Location filled', ready: Boolean(form.city.trim() && form.state.trim()) },
];

const StatCard = ({ label, value, detail, style, isWhiteMode }) => (
    <div
        className={cn(
            'rounded-[1.35rem] border p-4 backdrop-blur-xl',
            isWhiteMode ? 'bg-white/92 text-slate-900' : 'bg-[#091121]/72 text-white'
        )}
        style={style}
    >
        <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', isWhiteMode ? 'text-slate-500' : 'text-slate-400')}>
            {label}
        </p>
        <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        <p className={cn('mt-1 text-sm', isWhiteMode ? 'text-slate-600' : 'text-slate-400')}>
            {detail}
        </p>
    </div>
);

export default function Sell() {
    const { currentUser } = useContext(AuthContext);
    const { colorMode } = useColorMode();
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [processingImages, setProcessingImages] = useState(false);
    const [detectingLocation, setDetectingLocation] = useState(false);
    const [error, setError] = useState('');
    const [locationHint, setLocationHint] = useState('');
    const [success, setSuccess] = useState(false);

    const [form, setForm] = useState({
        category: '',
        title: '',
        description: '',
        price: '',
        negotiable: true,
        condition: 'good',
        escrowOptIn: true,
        images: [],
        city: '',
        state: '',
        pincode: '',
        geo: {
            latitude: null,
            longitude: null,
            accuracy: null,
            confidence: null,
            source: '',
            capturedAt: '',
        },
    });

    const isWhiteMode = colorMode === 'white';
    const modePalette = FIGMA_COLOR_MODE_OPTIONS.find((mode) => mode.value === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0];
    const accentPrimary = modePalette.primary;
    const accentSecondary = modePalette.secondary;
    const selectedCat = CATEGORIES.find((category) => category.value === form.category) || null;
    const selectedCondition = CONDITIONS.find((condition) => condition.value === form.condition) || CONDITIONS[2];
    const sellerLabel = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Seller';
    const progressPercent = ((step + 1) / STEP_META.length) * 100;
    const completionItems = useMemo(() => studioChecklist(form), [form]);
    const readyCount = completionItems.filter((item) => item.ready).length;
    const previewLocation = [form.city.trim(), form.state.trim()].filter(Boolean).join(', ') || 'Location pending';
    const pricePreview = Number(form.price) > 0 ? formatPrice(Number(form.price)) : 'Set your ask';

    const shellClass = isWhiteMode ? 'bg-[#eef4ff] text-slate-900' : 'bg-[#050816] text-slate-100';
    const panelClass = isWhiteMode
        ? 'border-slate-200 bg-white/96 shadow-[0_24px_70px_rgba(15,23,42,0.08)]'
        : 'border-white/10 bg-[#07101f]/80 shadow-[0_24px_80px_rgba(2,8,23,0.45)]';
    const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-400';
    const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-500';
    const labelClass = isWhiteMode ? 'text-slate-700' : 'text-slate-200';
    const inputClass = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
        : 'border-white/10 bg-[#091224]/90 text-white placeholder:text-slate-500';
    const helperCardClass = isWhiteMode ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-white/10 bg-white/[0.03] text-slate-200';
    const chipClass = isWhiteMode ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-slate-200';

    const heroStyle = isWhiteMode
        ? {
            background: `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.12)}, transparent 32%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,247,255,0.98))`,
            borderColor: toRgba(accentPrimary, 0.18),
        }
        : {
            background: `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.22)}, transparent 32%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.2)}, transparent 30%), linear-gradient(135deg, rgba(5,10,22,0.96), rgba(8,17,34,0.94))`,
            borderColor: toRgba(accentPrimary, 0.2),
        };

    const panelStyle = { borderColor: toRgba(accentPrimary, 0.14) };

    const previewStyle = isWhiteMode
        ? {
            background: `radial-gradient(circle at top right, ${toRgba(accentPrimary, 0.12)}, transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,247,255,0.98))`,
            borderColor: toRgba(accentPrimary, 0.18),
        }
        : {
            background: `radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.18)}, transparent 30%), linear-gradient(180deg, rgba(7,15,30,0.96), rgba(4,8,20,0.98))`,
            borderColor: toRgba(accentPrimary, 0.16),
        };

    const accentFillStyle = {
        backgroundImage: `linear-gradient(90deg, ${accentPrimary}, ${accentSecondary})`,
        color: isWhiteMode ? '#ffffff' : '#020617',
    };

    const accentOutlineStyle = {
        borderColor: toRgba(accentPrimary, isWhiteMode ? 0.28 : 0.32),
        background: isWhiteMode ? toRgba(accentPrimary, 0.08) : toRgba(accentPrimary, 0.12),
        color: isWhiteMode ? accentPrimary : '#f8fafc',
    };

    const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

    const updateLocationField = (key, value) => {
        setForm((prev) => ({
            ...prev,
            [key]: value,
            geo: {
                latitude: null,
                longitude: null,
                accuracy: null,
                confidence: null,
                source: 'manual',
                capturedAt: prev.geo?.capturedAt || '',
            },
        }));
    };

    const goToStep = (targetStep) => {
        setError('');
        setStep(targetStep);
    };

    const canProceed = () => {
        switch (step) {
            case 0:
                return Boolean(form.category);
            case 1:
                return form.title.trim().length >= 5 && form.description.trim().length >= 10 && Number(form.price) > 0;
            case 2:
                return form.images.length >= 1;
            case 3:
                return Boolean(form.city.trim() && form.state.trim());
            default:
                return true;
        }
    };

    const handleImageUpload = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';

        if (files.length === 0) return;

        if (form.images.length + files.length > MAX_IMAGES) {
            setError(`Maximum ${MAX_IMAGES} images allowed`);
            return;
        }

        setProcessingImages(true);
        setError('');

        try {
            const processedImages = [];

            for (const file of files) {
                if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                    throw new Error('Only JPG, PNG, and WEBP images are allowed.');
                }

                if (file.size > MAX_SOURCE_FILE_BYTES) {
                    throw new Error('Each source image must be smaller than 10MB.');
                }

                const dataUrl = await compressImageToWebp(file);
                if (estimateDataUriBytes(dataUrl) > MAX_ENCODED_IMAGE_BYTES) {
                    throw new Error('Image is too large after compression. Choose a smaller photo.');
                }

                processedImages.push(dataUrl);
            }

            setForm((prev) => ({
                ...prev,
                images: [...prev.images, ...processedImages].slice(0, MAX_IMAGES),
            }));
        } catch (uploadError) {
            setError(uploadError.message || 'Failed to process image.');
        } finally {
            setProcessingImages(false);
        }
    };

    const removeImage = (index) => {
        setForm((prev) => ({
            ...prev,
            images: prev.images.filter((_, imageIndex) => imageIndex !== index),
        }));
    };

    const handleDetectLocation = async () => {
        setDetectingLocation(true);
        setError('');
        setLocationHint('');

        try {
            const detected = await detectLocationFromGps();
            setForm((prev) => ({
                ...prev,
                city: detected.city || prev.city,
                state: detected.state || prev.state,
                pincode: detected.pincode || prev.pincode,
                geo: {
                    latitude: detected.latitude,
                    longitude: detected.longitude,
                    accuracy: detected.accuracy,
                    confidence: detected.confidence,
                    source: `${detected.positionSource || 'gps'}:${detected.geocodeSource || 'unknown'}`,
                    capturedAt: detected.capturedAt || new Date().toISOString(),
                },
            }));

            const locationParts = [detected.city, detected.state].filter(Boolean);
            const summary = locationParts.join(', ');
            const qualityBits = [
                Number.isFinite(detected.confidence) ? `confidence ${detected.confidence}%` : '',
                Number.isFinite(detected.accuracy) && detected.accuracy > 0 ? `${Math.round(detected.accuracy)}m accuracy` : '',
            ].filter(Boolean);
            const qualitySuffix = qualityBits.length > 0 ? ` (${qualityBits.join(', ')})` : '';
            setLocationHint(summary ? `Detected: ${summary}${qualitySuffix}` : `Location detected from GPS${qualitySuffix}.`);
        } catch (locationError) {
            setError(locationError?.message || 'Could not detect your location. Enter it manually.');
        } finally {
            setDetectingLocation(false);
        }
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError('');

        try {
            const payload = {
                title: form.title.trim(),
                description: form.description.trim(),
                price: Number(form.price),
                negotiable: form.negotiable,
                escrowOptIn: form.escrowOptIn,
                condition: form.condition,
                category: form.category,
                images: form.images,
                location: {
                    city: form.city.trim(),
                    state: form.state.trim(),
                    pincode: form.pincode.trim(),
                    latitude: form.geo?.latitude,
                    longitude: form.geo?.longitude,
                    accuracyMeters: form.geo?.accuracy,
                    confidence: form.geo?.confidence,
                    provider: form.geo?.source,
                    capturedAt: form.geo?.capturedAt || '',
                },
            };

            await listingApi.createListing(payload);
            setSuccess(true);
            setTimeout(() => navigate('/my-listings'), 1800);
        } catch (submitError) {
            setError(submitError.message || 'Failed to create listing.');
        } finally {
            setLoading(false);
        }
    };

    const renderStepBody = () => {
        if (step === 0) {
            return (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {CATEGORIES.map((category) => {
                        const Icon = category.icon;
                        const selected = form.category === category.value;

                        return (
                            <button
                                key={category.value}
                                type="button"
                                onClick={() => update('category', category.value)}
                                className={cn(
                                    'group rounded-[1.5rem] border p-5 text-left transition-all duration-300',
                                    selected
                                        ? 'translate-y-[-2px]'
                                        : isWhiteMode
                                            ? 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]'
                                            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                                )}
                                style={selected ? {
                                    borderColor: toRgba(category.color, 0.38),
                                    background: isWhiteMode
                                        ? `linear-gradient(180deg, ${toRgba(category.color, 0.08)}, rgba(255,255,255,0.98))`
                                        : `linear-gradient(180deg, ${toRgba(category.color, 0.16)}, rgba(10,16,30,0.94))`,
                                    boxShadow: `0 18px 44px ${toRgba(category.color, isWhiteMode ? 0.12 : 0.18)}`,
                                } : undefined}
                            >
                                <div
                                    className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border"
                                    style={{
                                        borderColor: toRgba(category.color, 0.28),
                                        background: toRgba(category.color, 0.14),
                                        color: category.color,
                                    }}
                                >
                                    <Icon className="h-6 w-6" />
                                </div>
                                <div className="mt-5 flex items-start justify-between gap-3">
                                    <div>
                                        <p className={cn('text-base font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                            {category.label}
                                        </p>
                                        <p className={cn('mt-2 text-sm leading-6', mutedTextClass)}>
                                            {category.subtitle}
                                        </p>
                                    </div>
                                    {selected ? (
                                        <div
                                            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full"
                                            style={{
                                                background: `linear-gradient(135deg, ${category.color}, ${accentSecondary})`,
                                                color: isWhiteMode ? '#ffffff' : '#020617',
                                            }}
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                        </div>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
            );
        }

        if (step === 1) {
            return (
                <div className="grid gap-6">
                    <div>
                        <label className={cn('mb-2 block text-sm font-bold', labelClass)}>Title</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(event) => update('title', event.target.value)}
                            placeholder="Example: iPhone 14 Pro Max 256GB, graphite, pristine battery"
                            maxLength={120}
                            className={cn('w-full rounded-[1.25rem] border px-4 py-4 text-base outline-none transition-all', inputClass)}
                        />
                        <div className={cn('mt-2 flex items-center justify-between text-xs', subtleTextClass)}>
                            <span>Use a title buyers can trust in one glance.</span>
                            <span>{form.title.length}/120</span>
                        </div>
                    </div>

                    <div>
                        <label className={cn('mb-2 block text-sm font-bold', labelClass)}>Description</label>
                        <textarea
                            value={form.description}
                            onChange={(event) => update('description', event.target.value)}
                            placeholder="Describe condition, included accessories, purchase age, warranty status, and why you are selling."
                            rows={6}
                            maxLength={2000}
                            className={cn('w-full resize-none rounded-[1.25rem] border px-4 py-4 text-base outline-none transition-all', inputClass)}
                        />
                        <div className={cn('mt-2 flex items-center justify-between text-xs', subtleTextClass)}>
                            <span>Specificity builds credibility and saves buyer questions.</span>
                            <span>{form.description.length}/2000</span>
                        </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className={cn('rounded-[1.5rem] border p-4', helperCardClass)} style={panelStyle}>
                            <label className={cn('mb-2 block text-sm font-bold', labelClass)}>Ask price</label>
                            <div className="relative">
                                <DollarSign className={cn('absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2', subtleTextClass)} />
                                <input
                                    type="number"
                                    value={form.price}
                                    onChange={(event) => update('price', event.target.value)}
                                    placeholder="0"
                                    min={0}
                                    className={cn('w-full rounded-[1.15rem] border px-4 py-4 pl-11 text-lg font-black outline-none transition-all', inputClass)}
                                />
                            </div>
                            <p className={cn('mt-2 text-xs', subtleTextClass)}>
                                Premium pricing wins when the story, photos, and condition all support it.
                            </p>
                        </div>

                        <div className={cn('rounded-[1.5rem] border p-4', helperCardClass)} style={panelStyle}>
                            <p className={cn('text-sm font-bold', labelClass)}>Sale settings</p>
                            <label className="mt-3 flex items-start gap-3">
                                <input
                                    type="checkbox"
                                    checked={form.negotiable}
                                    onChange={(event) => update('negotiable', event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-400"
                                />
                                <div>
                                    <p className={cn('text-sm font-semibold', labelClass)}>Negotiable</p>
                                    <p className={cn('text-xs', mutedTextClass)}>Allow room for buyer offers.</p>
                                </div>
                            </label>
                            <label className="mt-4 flex items-start gap-3">
                                <input
                                    type="checkbox"
                                    checked={form.escrowOptIn}
                                    onChange={(event) => update('escrowOptIn', event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-400"
                                />
                                <div>
                                    <p className={cn('text-sm font-semibold', labelClass)}>Escrow mode</p>
                                    <p className={cn('text-xs', mutedTextClass)}>Release funds after delivery confirmation.</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className={cn('mb-3 block text-sm font-bold', labelClass)}>Condition</label>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {CONDITIONS.map((condition) => {
                                const selected = form.condition === condition.value;
                                return (
                                    <button
                                        key={condition.value}
                                        type="button"
                                        onClick={() => update('condition', condition.value)}
                                        className={cn(
                                            'rounded-[1.35rem] border p-4 text-left transition-all duration-300',
                                            selected
                                                ? 'translate-y-[-1px]'
                                                : isWhiteMode
                                                    ? 'border-slate-200 bg-white hover:border-slate-300'
                                                    : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                                        )}
                                        style={selected ? accentOutlineStyle : undefined}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className={cn('text-sm font-black uppercase tracking-[0.18em]', selected ? '' : subtleTextClass)}>
                                                    {condition.label}
                                                </p>
                                                <p className={cn('mt-2 text-sm leading-6', selected ? (isWhiteMode ? 'text-slate-700' : 'text-slate-100') : mutedTextClass)}>
                                                    {condition.desc}
                                                </p>
                                            </div>
                                            {selected ? <BadgeCheck className="mt-1 h-5 w-5" /> : null}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            );
        }

        if (step === 2) {
            return (
                <div className="space-y-6">
                    <label
                        className={cn(
                            'group flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border border-dashed px-6 py-10 text-center transition-all duration-300',
                            isWhiteMode ? 'bg-white/80 hover:bg-white' : 'bg-white/[0.025] hover:bg-white/[0.04]'
                        )}
                        style={{
                            borderColor: toRgba(accentPrimary, 0.3),
                            boxShadow: `inset 0 0 0 1px ${toRgba(accentPrimary, 0.06)}`,
                        }}
                    >
                        <div
                            className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border"
                            style={{
                                borderColor: toRgba(accentPrimary, 0.28),
                                background: toRgba(accentPrimary, 0.12),
                                color: accentPrimary,
                            }}
                        >
                            {processingImages ? <Loader2 className="h-7 w-7 animate-spin" /> : <ImagePlus className="h-7 w-7" />}
                        </div>
                        <p className={cn('mt-5 text-lg font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                            {processingImages ? 'Processing your media' : 'Drop up to five premium-quality photos'}
                        </p>
                        <p className={cn('mt-2 max-w-xl text-sm leading-6', mutedTextClass)}>
                            Natural light, multiple angles, and one clean hero image will instantly make the listing feel more credible.
                        </p>
                        <div className="mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em]" style={accentOutlineStyle}>
                            <Camera className="h-4 w-4" />
                            {form.images.length}/{MAX_IMAGES} uploaded
                        </div>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                    </label>

                    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                        {form.images.map((image, index) => (
                            <div
                                key={`${image.slice(0, 30)}-${index}`}
                                className={cn(
                                    'group relative aspect-square overflow-hidden rounded-[1.35rem] border',
                                    isWhiteMode ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.04]'
                                )}
                            >
                                <img src={image} alt={`Listing preview ${index + 1}`} className="h-full w-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeImage(index)}
                                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-label={`Remove photo ${index + 1}`}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                                <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
                                    {index === 0 ? (
                                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-900">
                                            Cover shot
                                        </span>
                                    ) : <span />}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        if (step === 3) {
            return (
                <div className="grid gap-6">
                    <div
                        className={cn(
                            'rounded-[1.5rem] border p-5',
                            isWhiteMode ? 'bg-white/80' : 'bg-white/[0.03]'
                        )}
                        style={panelStyle}
                    >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className={cn('text-sm font-black uppercase tracking-[0.2em]', subtleTextClass)}>
                                    Precision location
                                </p>
                                <p className={cn('mt-2 text-lg font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                    Use current location for higher trust.
                                </p>
                                <p className={cn('mt-2 text-sm leading-6', mutedTextClass)}>
                                    GPS-assisted detection helps buyers gauge pickup confidence and distance faster.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={handleDetectLocation}
                                disabled={detectingLocation}
                                className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.18em] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                style={accentFillStyle}
                            >
                                {detectingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                                {detectingLocation ? 'Detecting' : 'Use current location'}
                            </button>
                        </div>
                        {locationHint ? (
                            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={accentOutlineStyle}>
                                {locationHint}
                            </div>
                        ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className={cn('mb-2 block text-sm font-bold', labelClass)}>City</label>
                            <div className="relative">
                                <MapPin className={cn('absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2', subtleTextClass)} />
                                <input
                                    type="text"
                                    value={form.city}
                                    onChange={(event) => updateLocationField('city', event.target.value)}
                                    placeholder="Example: Mumbai"
                                    className={cn('w-full rounded-[1.25rem] border px-4 py-4 pl-11 outline-none transition-all', inputClass)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={cn('mb-2 block text-sm font-bold', labelClass)}>State</label>
                            <input
                                type="text"
                                value={form.state}
                                onChange={(event) => updateLocationField('state', event.target.value)}
                                placeholder="Example: Maharashtra"
                                className={cn('w-full rounded-[1.25rem] border px-4 py-4 outline-none transition-all', inputClass)}
                            />
                        </div>
                    </div>

                    <div className="max-w-sm">
                        <label className={cn('mb-2 block text-sm font-bold', labelClass)}>Pincode</label>
                        <input
                            type="text"
                            value={form.pincode}
                            onChange={(event) => updateLocationField('pincode', event.target.value)}
                            placeholder="Example: 400001"
                            maxLength={6}
                            className={cn('w-full rounded-[1.25rem] border px-4 py-4 outline-none transition-all', inputClass)}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-5">
                <div className={cn('overflow-hidden rounded-[1.75rem] border', panelClass)} style={previewStyle}>
                    <div
                        className="relative flex min-h-[260px] items-end overflow-hidden border-b p-6"
                        style={{
                            borderColor: toRgba(accentPrimary, 0.14),
                            background: form.images[0]
                                ? `linear-gradient(180deg, rgba(2,6,23,0.18), rgba(2,6,23,0.74)), url(${form.images[0]}) center/cover`
                                : `radial-gradient(circle at top, ${toRgba(accentPrimary, 0.18)}, transparent 58%), linear-gradient(180deg, ${toRgba(accentSecondary, 0.12)}, rgba(255,255,255,0.02))`,
                        }}
                    >
                        <div className="max-w-lg">
                            <div className="flex flex-wrap gap-2">
                                {selectedCat ? (
                                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-900">
                                        {selectedCat.label}
                                    </span>
                                ) : null}
                                <span className="rounded-full border border-white/25 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                                    {selectedCondition.label}
                                </span>
                            </div>
                            <h3 className="mt-5 text-2xl font-black tracking-tight text-white sm:text-3xl">
                                {form.title.trim() || 'Your listing headline will appear here'}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-white/80">
                                {form.description.trim() || 'Add a confident, detail-rich description so buyers know why this item is worth the ask.'}
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-5 p-6 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]" style={accentOutlineStyle}>
                                    {form.negotiable ? 'Negotiable' : 'Fixed price'}
                                </span>
                                {form.escrowOptIn ? (
                                    <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">
                                        Escrow enabled
                                    </span>
                                ) : null}
                            </div>

                            <div className="flex items-end gap-3">
                                <p className={cn('text-3xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                    {pricePreview}
                                </p>
                            </div>

                            <div className={cn('flex flex-wrap items-center gap-3 text-sm', mutedTextClass)}>
                                <span className="inline-flex items-center gap-2">
                                    <MapPin className="h-4 w-4" />
                                    {previewLocation}
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Store className="h-4 w-4" />
                                    {sellerLabel}
                                </span>
                            </div>
                        </div>

                        <div className={cn('rounded-[1.5rem] border p-4', helperCardClass)} style={panelStyle}>
                            <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                Quality signal
                            </p>
                            <div className="mt-3 space-y-3 text-sm">
                                {completionItems.map((item) => (
                                    <div key={item.label} className="flex items-center justify-between gap-3">
                                        <span className={labelClass}>{item.label}</span>
                                        <span className={cn(
                                            'inline-flex h-7 w-7 items-center justify-center rounded-full border',
                                            item.ready
                                                ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
                                                : isWhiteMode
                                                    ? 'border-slate-200 bg-white text-slate-400'
                                                    : 'border-white/10 bg-white/[0.04] text-slate-500'
                                        )}>
                                            <CheckCircle2 className="h-4 w-4" />
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    if (success) {
        return (
            <div className={cn('min-h-screen px-4 py-16', shellClass)}>
                <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
                    <div className={cn('w-full overflow-hidden rounded-[2.2rem] border p-8 text-center sm:p-10', panelClass)} style={heroStyle}>
                        <div
                            className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full border"
                            style={{
                                borderColor: toRgba(accentPrimary, 0.3),
                                background: `linear-gradient(135deg, ${toRgba(accentPrimary, 0.2)}, ${toRgba(accentSecondary, 0.18)})`,
                            }}
                        >
                            <CheckCircle2 className="h-10 w-10" />
                        </div>
                        <p className={cn('mt-6 text-[11px] font-black uppercase tracking-[0.24em]', subtleTextClass)}>
                            Listing published
                        </p>
                        <h1 className={cn('mt-3 text-4xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                            Your item is now live.
                        </h1>
                        <p className={cn('mx-auto mt-4 max-w-xl text-base leading-7', mutedTextClass)}>
                            We are taking you to your seller dashboard so you can manage responses, price moves, and listing health in one place.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cn('min-h-screen pb-20', shellClass)}>
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <div
                    className="absolute inset-0"
                    style={{
                        background: isWhiteMode
                            ? `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.12)}, transparent 26%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 24%), linear-gradient(180deg, #f5f8ff 0%, #eef4ff 48%, #f8fbff 100%)`
                            : `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.16)}, transparent 24%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 22%), linear-gradient(180deg, #040611 0%, #050816 42%, #070d1d 100%)`,
                    }}
                />
                <div className={cn('absolute inset-0 opacity-40 [background-size:52px_52px]', isWhiteMode ? 'bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)]' : 'bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)]')} />
            </div>
            <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
                <section className={cn('relative overflow-hidden rounded-[2.2rem] border px-6 py-7 sm:px-8 sm:py-8', panelClass)} style={heroStyle}>
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]" style={accentOutlineStyle}>
                                <Sparkles className="h-4 w-4" />
                                Seller studio
                            </div>
                            <h1 className={cn('mt-5 max-w-3xl text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                List with the polish of a premium storefront.
                            </h1>
                            <p className={cn('mt-4 max-w-2xl text-sm leading-7 sm:text-base', mutedTextClass)}>
                                This flow is tuned to help your listing look intentional from the first glance: stronger categorization, cleaner media, trustworthy location, and a review pass before buyers ever land on the page.
                            </p>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <span className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm', chipClass)} style={panelStyle}>
                                    <Store className="h-4 w-4" />
                                    {sellerLabel}
                                </span>
                                <span className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm', chipClass)} style={panelStyle}>
                                    <ShieldCheck className="h-4 w-4" />
                                    {form.escrowOptIn ? 'Escrow ready' : 'Escrow optional'}
                                </span>
                                <span className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm', chipClass)} style={panelStyle}>
                                    <Camera className="h-4 w-4" />
                                    {form.images.length}/{MAX_IMAGES} photos
                                </span>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                            <StatCard
                                label="Studio progress"
                                value={`${Math.round(progressPercent)}%`}
                                detail={`${readyCount}/${completionItems.length} publish checks ready`}
                                style={panelStyle}
                                isWhiteMode={isWhiteMode}
                            />
                            <StatCard
                                label="Current lane"
                                value={selectedCat?.label || 'Unassigned'}
                                detail={selectedCat?.subtitle || 'Choose the category where the item belongs.'}
                                style={panelStyle}
                                isWhiteMode={isWhiteMode}
                            />
                            <StatCard
                                label="Listing mode"
                                value={form.escrowOptIn ? 'Escrow' : 'Direct'}
                                detail={form.negotiable ? 'Negotiation is open.' : 'Price is fixed for now.'}
                                style={panelStyle}
                                isWhiteMode={isWhiteMode}
                            />
                        </div>
                    </div>

                    <div className="mt-8">
                        <div className={cn('h-2 overflow-hidden rounded-full', isWhiteMode ? 'bg-slate-200' : 'bg-white/10')}>
                            <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                    width: `${progressPercent}%`,
                                    backgroundImage: `linear-gradient(90deg, ${accentPrimary}, ${accentSecondary})`,
                                }}
                            />
                        </div>
                    </div>
                </section>

                <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <section className={cn('rounded-[2rem] border p-5 sm:p-6', panelClass)} style={panelStyle}>
                        <div className="flex flex-wrap gap-3">
                            {STEP_META.map((item, index) => {
                                const Icon = item.icon;
                                const isActive = index === step;
                                const isComplete = index < step;
                                const isClickable = index <= step;

                                return (
                                    <button
                                        key={item.kicker}
                                        type="button"
                                        onClick={() => {
                                            if (isClickable) {
                                                goToStep(index);
                                            }
                                        }}
                                        disabled={!isClickable}
                                        className={cn(
                                            'group min-w-[150px] flex-1 rounded-[1.35rem] border p-4 text-left transition-all duration-300',
                                            isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
                                            isActive
                                                ? 'translate-y-[-1px]'
                                                : isWhiteMode
                                                    ? 'border-slate-200 bg-slate-50'
                                                    : 'border-white/10 bg-white/[0.03]'
                                        )}
                                        style={isActive ? accentOutlineStyle : (isComplete ? {
                                            borderColor: toRgba(accentSecondary, 0.28),
                                            background: isWhiteMode ? toRgba(accentSecondary, 0.08) : toRgba(accentSecondary, 0.1),
                                        } : undefined)}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div
                                                className={cn(
                                                    'inline-flex h-10 w-10 items-center justify-center rounded-2xl border',
                                                    isComplete ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100' : ''
                                                )}
                                                style={!isComplete ? {
                                                    borderColor: toRgba(isActive ? accentPrimary : '#64748b', isActive ? 0.28 : 0.16),
                                                    background: isActive ? toRgba(accentPrimary, 0.12) : (isWhiteMode ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.04)'),
                                                    color: isActive ? accentPrimary : (isWhiteMode ? '#475569' : '#cbd5e1'),
                                                } : undefined}
                                            >
                                                {isComplete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                                            </div>
                                            <span className={cn('text-[10px] font-black uppercase tracking-[0.2em]', subtleTextClass)}>
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                        </div>
                                        <p className={cn('mt-4 text-sm font-black uppercase tracking-[0.18em]', isActive ? '' : subtleTextClass)}>
                                            {item.kicker}
                                        </p>
                                        <p className={cn('mt-2 text-sm leading-6', isActive ? (isWhiteMode ? 'text-slate-700' : 'text-slate-100') : mutedTextClass)}>
                                            {item.title}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        {error ? (
                            <div className={cn(
                                'mt-6 rounded-[1.35rem] border px-4 py-3 text-sm',
                                isWhiteMode ? 'border-red-200 bg-red-50 text-red-700' : 'border-red-400/20 bg-red-500/10 text-red-100'
                            )}>
                                {error}
                            </div>
                        ) : null}

                        <div className="mt-6 rounded-[1.75rem] border p-5 sm:p-6" style={previewStyle}>
                            <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: toRgba(accentPrimary, 0.14) }}>
                                <div>
                                    <p className={cn('text-[11px] font-black uppercase tracking-[0.24em]', subtleTextClass)}>
                                        {STEP_META[step].kicker}
                                    </p>
                                    <h2 className={cn('mt-3 text-2xl font-black tracking-tight sm:text-3xl', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                        {STEP_META[step].title}
                                    </h2>
                                </div>
                                <p className={cn('max-w-xl text-sm leading-6 sm:text-right', mutedTextClass)}>
                                    {STEP_META[step].description}
                                </p>
                            </div>

                            <div className="mt-6">
                                {renderStepBody()}
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                            {step > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => goToStep(step - 1)}
                                    className={cn(
                                        'inline-flex w-full items-center justify-center gap-2 rounded-full border px-6 py-3 text-sm font-black uppercase tracking-[0.18em] transition-all sm:w-auto',
                                        chipClass
                                    )}
                                    style={panelStyle}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Back
                                </button>
                            ) : (
                                <div />
                            )}

                            {step < STEP_META.length - 1 ? (
                                <button
                                    type="button"
                                    onClick={() => goToStep(step + 1)}
                                    disabled={!canProceed() || processingImages}
                                    className={cn(
                                        'inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3 text-sm font-black uppercase tracking-[0.18em] transition-all sm:w-auto',
                                        (!canProceed() || processingImages) && 'cursor-not-allowed opacity-50'
                                    )}
                                    style={accentFillStyle}
                                >
                                    Continue
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={loading || processingImages}
                                    className={cn(
                                        'inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3 text-sm font-black uppercase tracking-[0.18em] transition-all sm:w-auto',
                                        (loading || processingImages) && 'cursor-not-allowed opacity-60'
                                    )}
                                    style={accentFillStyle}
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                                    {loading ? 'Publishing' : 'Publish listing'}
                                </button>
                            )}
                        </div>
                    </section>

                    <aside className="space-y-6 xl:sticky xl:top-28 xl:self-start">
                        <section className={cn('overflow-hidden rounded-[2rem] border', panelClass)} style={previewStyle}>
                            <div
                                className="relative flex min-h-[280px] items-end overflow-hidden border-b p-5"
                                style={{
                                    borderColor: toRgba(accentPrimary, 0.14),
                                    background: form.images[0]
                                        ? `linear-gradient(180deg, rgba(2,6,23,0.12), rgba(2,6,23,0.78)), url(${form.images[0]}) center/cover`
                                        : `radial-gradient(circle at top, ${toRgba(accentPrimary, 0.18)}, transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))`,
                                }}
                            >
                                {!form.images[0] ? (
                                    <div className="w-full text-center">
                                        <div
                                            className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl border"
                                            style={{
                                                borderColor: toRgba(accentPrimary, 0.26),
                                                background: toRgba(accentPrimary, 0.12),
                                                color: accentPrimary,
                                            }}
                                        >
                                            <Camera className="h-7 w-7" />
                                        </div>
                                        <p className="mt-4 text-sm font-bold text-white/90">Live buyer preview</p>
                                    </div>
                                ) : null}

                                <div className="absolute left-5 top-5 flex flex-wrap gap-2">
                                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-900">
                                        {selectedCat?.label || 'Category'}
                                    </span>
                                    <span className="rounded-full border border-white/25 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                                        {selectedCondition.label}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-5 p-5">
                                <div>
                                    <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                        Live listing preview
                                    </p>
                                    <h3 className={cn('mt-3 text-2xl font-black leading-tight tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                        {form.title.trim() || 'Your title will appear here'}
                                    </h3>
                                    <p className={cn('mt-2 text-sm leading-6', mutedTextClass)}>
                                        {form.description.trim() || 'A premium listing reads clearly, sounds credible, and answers the buyer before they ask.'}
                                    </p>
                                </div>

                                <div className="flex items-end justify-between gap-3">
                                    <div>
                                        <p className={cn('text-3xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                            {pricePreview}
                                        </p>
                                        <p className={cn('mt-1 text-xs uppercase tracking-[0.18em]', subtleTextClass)}>
                                            {form.negotiable ? 'Negotiation open' : 'Fixed ask'}
                                        </p>
                                    </div>
                                    {form.escrowOptIn ? (
                                        <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">
                                            Escrow
                                        </span>
                                    ) : null}
                                </div>

                                <div className="space-y-3">
                                    <div className={cn('flex items-center gap-3 rounded-[1.15rem] border px-4 py-3', helperCardClass)} style={panelStyle}>
                                        <MapPin className="h-4 w-4" style={{ color: accentPrimary }} />
                                        <span className="text-sm">{previewLocation}</span>
                                    </div>
                                    <div className={cn('flex items-center gap-3 rounded-[1.15rem] border px-4 py-3', helperCardClass)} style={panelStyle}>
                                        <Store className="h-4 w-4" style={{ color: accentPrimary }} />
                                        <span className="text-sm">{sellerLabel}</span>
                                    </div>
                                    <div className={cn('flex items-center gap-3 rounded-[1.15rem] border px-4 py-3', helperCardClass)} style={panelStyle}>
                                        <ShieldCheck className="h-4 w-4" style={{ color: accentPrimary }} />
                                        <span className="text-sm">{form.escrowOptIn ? 'Protected by escrow workflow' : 'Direct seller workflow'}</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className={cn('rounded-[2rem] border p-5', panelClass)} style={panelStyle}>
                            <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                Publish checklist
                            </p>
                            <div className="mt-4 space-y-3">
                                {completionItems.map((item) => (
                                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-[1.15rem] border px-4 py-3" style={panelStyle}>
                                        <span className={cn('text-sm font-medium', labelClass)}>{item.label}</span>
                                        <span className={cn(
                                            'inline-flex h-8 w-8 items-center justify-center rounded-full border',
                                            item.ready
                                                ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
                                                : isWhiteMode
                                                    ? 'border-slate-200 bg-white text-slate-400'
                                                    : 'border-white/10 bg-white/[0.04] text-slate-500'
                                        )}>
                                            <CheckCircle2 className="h-4 w-4" />
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}
