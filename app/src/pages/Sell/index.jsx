import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Camera, MapPin, Tag, DollarSign, ChevronRight, ChevronLeft,
    Smartphone, Laptop, Car, Sofa, Shirt, BookOpen, Dumbbell,
    Gamepad2, Home as HomeIcon, Package, CheckCircle, Loader2, X, ImagePlus
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { listingApi } from '@/services/api';
import { detectLocationFromGps } from '@/utils/geolocation';

const CATEGORIES = [
    { value: 'mobiles', label: 'Mobiles', icon: Smartphone, color: '#3b82f6' },
    { value: 'laptops', label: 'Laptops', icon: Laptop, color: '#8b5cf6' },
    { value: 'electronics', label: 'Electronics', icon: Package, color: '#06b6d4' },
    { value: 'vehicles', label: 'Vehicles', icon: Car, color: '#f59e0b' },
    { value: 'furniture', label: 'Furniture', icon: Sofa, color: '#10b981' },
    { value: 'fashion', label: 'Fashion', icon: Shirt, color: '#ec4899' },
    { value: 'books', label: 'Books', icon: BookOpen, color: '#6366f1' },
    { value: 'sports', label: 'Sports', icon: Dumbbell, color: '#14b8a6' },
    { value: 'home-appliances', label: 'Home & Kitchen', icon: HomeIcon, color: '#f97316' },
    { value: 'gaming', label: 'Gaming', icon: Gamepad2, color: '#a855f7' },
    { value: 'other', label: 'Other', icon: Tag, color: '#64748b' },
];

const CONDITIONS = [
    { value: 'new', label: 'Brand New', desc: 'Unused, sealed packaging' },
    { value: 'like-new', label: 'Like New', desc: 'Barely used, excellent condition' },
    { value: 'good', label: 'Good', desc: 'Minor wear, fully functional' },
    { value: 'fair', label: 'Fair', desc: 'Visible wear, works fine' },
];

const STEPS = ['Category', 'Details', 'Photos', 'Location', 'Review'];
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

export default function Sell() {
    const { currentUser } = useContext(AuthContext);
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [processingImages, setProcessingImages] = useState(false);
    const [detectingLocation, setDetectingLocation] = useState(false);
    const [error, setError] = useState('');
    const [locationHint, setLocationHint] = useState('');
    const [success, setSuccess] = useState(false);

    const [form, setForm] = useState({
        category: '', title: '', description: '', price: '',
        negotiable: true, condition: 'good',
        escrowOptIn: true,
        images: [],
        city: '', state: '', pincode: '',
        geo: {
            latitude: null,
            longitude: null,
            accuracy: null,
            confidence: null,
            source: '',
            capturedAt: '',
        },
    });

    const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
    const updateLocationField = (key, value) =>
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

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';

        if (files.length === 0) return;

        if (form.images.length + files.length > MAX_IMAGES) {
            setError('Maximum 5 images allowed');
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

            setForm(prev => ({ ...prev, images: [...prev.images, ...processedImages].slice(0, MAX_IMAGES) }));
        } catch (uploadError) {
            setError(uploadError.message || 'Failed to process image.');
        } finally {
            setProcessingImages(false);
        }
    };

    const removeImage = (idx) => {
        setForm(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));
    };

    const canProceed = () => {
        switch (step) {
            case 0: return !!form.category;
            case 1: return form.title.trim().length >= 5 && form.description.trim().length >= 10 && Number(form.price) > 0;
            case 2: return form.images.length >= 1;
            case 3: return form.city.trim() && form.state.trim();
            default: return true;
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
            setTimeout(() => navigate('/my-listings'), 2000);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
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

    if (success) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center">
                <div className="text-center p-8 bg-white rounded-2xl shadow-xl max-w-md">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Listed Successfully! 🎉</h2>
                    <p className="text-gray-500">Your item is now live on the marketplace</p>
                </div>
            </div>
        );
    }

    const selectedCat = CATEGORIES.find(c => c.value === form.category);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
            {/* Header */}
            <div className="bg-white border-b shadow-sm sticky top-20 md:top-24 z-20">
                <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Sell Your Item</h1>
                    {/* Step indicator */}
                    <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
                        {STEPS.map((s, i) => (
                            <div key={s} className="flex items-center">
                                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${i <= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                    {i < step ? '✓' : i + 1}
                                </div>
                                {i < STEPS.length - 1 && (
                                    <div className={`w-5 sm:w-6 h-0.5 ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 py-8">
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
                )}

                {/* Step 0: Category */}
                {step === 0 && (
                    <div>
                        <h2 className="text-2xl font-bold mb-6 text-gray-900">What are you selling?</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {CATEGORIES.map(cat => {
                                const Icon = cat.icon;
                                const selected = form.category === cat.value;
                                return (
                                    <button key={cat.value}
                                        onClick={() => update('category', cat.value)}
                                        className={`p-6 rounded-2xl border-2 transition-all duration-200 text-center hover:shadow-lg
                      ${selected ? 'border-blue-500 bg-blue-50 shadow-md scale-105' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                                        <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3"
                                            style={{ background: `${cat.color}15` }}>
                                            <Icon className="w-7 h-7" style={{ color: cat.color }} />
                                        </div>
                                        <span className={`font-semibold text-sm ${selected ? 'text-blue-700' : 'text-gray-700'}`}>
                                            {cat.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 1: Details */}
                {step === 1 && (
                    <div className="space-y-6 max-w-2xl">
                        <h2 className="text-2xl font-bold text-gray-900">Item Details</h2>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                            <input type="text" value={form.title} onChange={e => update('title', e.target.value)}
                                placeholder="e.g., iPhone 14 Pro Max 256GB"
                                maxLength={120}
                                className="w-full p-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 outline-none transition-colors text-lg" />
                            <p className="text-xs text-gray-400 mt-1">{form.title.length}/120</p>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                            <textarea value={form.description} onChange={e => update('description', e.target.value)}
                                placeholder="Describe your item — condition, features, reason for selling..."
                                maxLength={2000} rows={4}
                                className="w-full p-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 outline-none transition-colors resize-none" />
                            <p className="text-xs text-gray-400 mt-1">{form.description.length}/2000</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Price (₹)</label>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-4 w-5 h-5 text-gray-400" />
                                    <input type="number" value={form.price} onChange={e => update('price', e.target.value)}
                                        placeholder="0" min={0}
                                        className="w-full p-4 pl-12 border-2 border-gray-200 rounded-xl focus:border-blue-500 outline-none text-lg font-bold" />
                                </div>
                            </div>
                            <div className="flex items-end">
                                <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border-2 border-gray-200 cursor-pointer w-full">
                                    <input type="checkbox" checked={form.negotiable}
                                        onChange={e => update('negotiable', e.target.checked)}
                                        className="w-5 h-5 text-blue-600 rounded" />
                                    <span className="font-semibold text-gray-700">Price is negotiable</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label className="flex items-center gap-3 p-4 bg-cyan-50 rounded-xl border-2 border-cyan-200 cursor-pointer w-full">
                                <input
                                    type="checkbox"
                                    checked={form.escrowOptIn}
                                    onChange={e => update('escrowOptIn', e.target.checked)}
                                    className="w-5 h-5 text-cyan-600 rounded"
                                />
                                <div>
                                    <span className="font-semibold text-cyan-900">Enable marketplace escrow mode</span>
                                    <p className="text-xs text-cyan-700 mt-0.5">
                                        Buyer payment is held and released only after delivery confirmation.
                                    </p>
                                </div>
                            </label>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-3">Condition</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {CONDITIONS.map(c => (
                                    <button key={c.value}
                                        onClick={() => update('condition', c.value)}
                                        className={`p-4 rounded-xl border-2 text-left transition-all
                      ${form.condition === c.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                                        <span className="font-bold text-sm">{c.label}</span>
                                        <p className="text-xs text-gray-500 mt-1">{c.desc}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Photos */}
                {step === 2 && (
                    <div className="max-w-2xl">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Add Photos</h2>
                        <p className="text-gray-500 mb-6">Upload up to 5 real photos. Images are compressed securely before upload.</p>

                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 mb-6">
                            {form.images.map((img, idx) => (
                                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border-2 border-gray-200 group">
                                    <img src={img} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                                    <button onClick={() => removeImage(idx)}
                                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <X className="w-4 h-4" />
                                    </button>
                                    {idx === 0 && (
                                        <span className="absolute bottom-1 left-1 px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full">COVER</span>
                                    )}
                                </div>
                            ))}
                            {form.images.length < 5 && (
                                <label className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                                    <ImagePlus className="w-8 h-8 text-gray-400 mb-1" />
                                    <span className="text-xs text-gray-400">Add Photo</span>
                                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                                </label>
                            )}
                        </div>
                        {processingImages && (
                            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 w-fit">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing photos...
                            </div>
                        )}
                    </div>
                )}

                {/* Step 3: Location */}
                {step === 3 && (
                    <div className="max-w-2xl space-y-6">
                        <h2 className="text-2xl font-bold text-gray-900">Your Location</h2>
                        <p className="text-gray-500">Help buyers find items near them</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={handleDetectLocation}
                                disabled={detectingLocation}
                                className="inline-flex items-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {detectingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                                {detectingLocation ? 'Detecting GPS...' : 'Use current location'}
                            </button>
                            {locationHint && (
                                <span className="text-sm font-medium text-emerald-700">{locationHint}</span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">City *</label>
                                <div className="relative">
                                    <MapPin className="absolute left-4 top-4 w-5 h-5 text-gray-400" />
                                    <input type="text" value={form.city} onChange={e => updateLocationField('city', e.target.value)}
                                        placeholder="e.g., Mumbai"
                                        className="w-full p-4 pl-12 border-2 border-gray-200 rounded-xl focus:border-blue-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">State *</label>
                                <input type="text" value={form.state} onChange={e => updateLocationField('state', e.target.value)}
                                    placeholder="e.g., Maharashtra"
                                    className="w-full p-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 outline-none" />
                            </div>
                        </div>
                        <div className="max-w-xs">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Pincode (optional)</label>
                            <input type="text" value={form.pincode} onChange={e => updateLocationField('pincode', e.target.value)}
                                placeholder="e.g., 400001" maxLength={6}
                                className="w-full p-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 outline-none" />
                        </div>
                    </div>
                )}

                {/* Step 4: Review */}
                {step === 4 && (
                    <div className="max-w-2xl">
                        <h2 className="text-2xl font-bold text-gray-900 mb-6">Review Your Listing</h2>
                        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                            {form.images[0] && (
                                <img src={form.images[0]} alt="Cover" className="w-full h-64 object-cover" />
                            )}
                            <div className="p-6 space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900">{form.title}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">{selectedCat?.label}</span>
                                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-full capitalize">{form.condition}</span>
                                            {form.negotiable && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">Negotiable</span>}
                                            {form.escrowOptIn && <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs font-bold rounded-full">Escrow Enabled</span>}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-2xl font-black text-gray-900">₹{Number(form.price).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                                <p className="text-gray-600 text-sm">{form.description}</p>
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                    <MapPin className="w-4 h-4" />
                                    <span>{form.city}, {form.state}</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {form.images.map((img, i) => (
                                        <img key={i} src={img} alt="" className="w-16 h-16 rounded-lg object-cover border" />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Navigation */}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-10 max-w-2xl">
                    {step > 0 ? (
                        <button onClick={() => { setStep(s => s - 1); setError(''); }}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                            <ChevronLeft className="w-5 h-5" /> Back
                        </button>
                    ) : <div />}

                    {step < 4 ? (
                        <button onClick={() => { setStep(s => s + 1); setError(''); }}
                            disabled={!canProceed() || processingImages}
                            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-white transition-all
                ${canProceed() && !processingImages ? 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/25' : 'bg-gray-300 cursor-not-allowed'}`}>
                            Next <ChevronRight className="w-5 h-5" />
                        </button>
                    ) : (
                        <button onClick={handleSubmit} disabled={loading || processingImages}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-600/25 transition-all">
                            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Posting...</> : '🚀 Post Listing'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

