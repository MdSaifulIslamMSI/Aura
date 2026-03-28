import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AdminPremiumShell from '@/components/shared/AdminPremiumShell';
import { useMarket } from '@/context/MarketContext';
import { adminApi } from '@/services/api/adminApi';
import { translateEnumLabel } from '@/utils/enumLocalization';
import { formatPrice } from '@/utils/format';

const emptySpecification = () => ({ key: '', value: '' });

const defaultForm = {
    title: '',
    brand: '',
    category: '',
    subCategory: '',
    description: '',
    image: '',
    countInStock: 0,
    deliveryTime: '',
    warranty: '',
    price: 0,
    originalPrice: 0,
    discountPercentage: 0,
    highlightsText: '',
    specifications: [emptySpecification()],
    coreReason: '',
    pricingReason: '',
};

const inputClass = 'admin-premium-control';

const sanitizeHighlights = (value = '') => String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

const sanitizeSpecifications = (entries = []) => entries
    .map((entry) => ({
        key: String(entry?.key || '').trim(),
        value: String(entry?.value || '').trim(),
    }))
    .filter((entry) => entry.key && entry.value)
    .slice(0, 30);

const mapProductToForm = (product = {}) => ({
    title: product.title || '',
    brand: product.brand || '',
    category: product.category || '',
    subCategory: product.subCategory || '',
    description: product.description || '',
    image: product.image || '',
    countInStock: Number(product.stock || 0),
    deliveryTime: product.deliveryTime || '',
    warranty: product.warranty || '',
    price: Number(product.price || 0),
    originalPrice: Number(product.originalPrice || product.price || 0),
    discountPercentage: Number(product.discountPercentage || 0),
    highlightsText: Array.isArray(product.highlights) ? product.highlights.join('\n') : '',
    specifications: Array.isArray(product.specifications) && product.specifications.length > 0
        ? product.specifications.map((entry) => ({ key: entry?.key || '', value: entry?.value || '' }))
        : [emptySpecification()],
    coreReason: '',
    pricingReason: '',
});

const pricingSnapshotFromForm = (form) => ({
    price: Number(form.price || 0),
    originalPrice: Number(form.originalPrice || 0),
    discountPercentage: Number(form.discountPercentage || 0),
});

const formatProductLogActionType = (t, value) => translateEnumLabel(t, 'admin.productEdit.actionType', value);

const ProductEdit = () => {
    const { t, formatDateTime } = useMarket();
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = !id || id === 'new';

    const [form, setForm] = useState(defaultForm);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logs, setLogs] = useState([]);
    const [initialPricing, setInitialPricing] = useState(pricingSnapshotFromForm(defaultForm));
    const [meta, setMeta] = useState({
        id: '',
        externalId: '',
        source: '',
        catalogVersion: '',
        updatedAt: '',
    });

    const loadProduct = async () => {
        if (isNew) return;
        try {
            setLoading(true);
            const response = await adminApi.getProductById(id);
            const product = response?.product || {};
            setForm((prev) => ({
                ...mapProductToForm(product),
                coreReason: prev.coreReason,
                pricingReason: prev.pricingReason,
            }));
            setInitialPricing(pricingSnapshotFromForm(mapProductToForm(product)));
            setMeta({
                id: String(product.id || ''),
                externalId: String(product.externalId || ''),
                source: String(product.source || ''),
                catalogVersion: String(product.catalogVersion || ''),
                updatedAt: product.updatedAt || '',
            });
        } catch (error) {
            toast.error(error.message || t('admin.productEdit.error.loadProduct', {}, 'Failed to load product'));
        } finally {
            setLoading(false);
        }
    };

    const loadLogs = async () => {
        if (isNew) return;
        try {
            setLogsLoading(true);
            const response = await adminApi.getProductLogs(id);
            setLogs(Array.isArray(response?.logs) ? response.logs : []);
        } catch (error) {
            toast.error(error.message || t('admin.productEdit.error.loadLogs', {}, 'Failed to load product logs'));
        } finally {
            setLogsLoading(false);
        }
    };

    useEffect(() => {
        loadProduct();
        loadLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, isNew]);

    const pricingChanged = useMemo(() => {
        const current = pricingSnapshotFromForm(form);
        return (
            Number(current.price) !== Number(initialPricing.price) ||
            Number(current.originalPrice) !== Number(initialPricing.originalPrice) ||
            Number(current.discountPercentage) !== Number(initialPricing.discountPercentage)
        );
    }, [form, initialPricing]);

    const updateSpecification = (index, field, value) => {
        setForm((prev) => ({
            ...prev,
            specifications: prev.specifications.map((entry, i) => (
                i === index ? { ...entry, [field]: value } : entry
            )),
        }));
    };

    const addSpecification = () => {
        setForm((prev) => ({
            ...prev,
            specifications: [...prev.specifications, emptySpecification()].slice(0, 30),
        }));
    };

    const removeSpecification = (index) => {
        setForm((prev) => {
            const next = prev.specifications.filter((_, i) => i !== index);
            return {
                ...prev,
                specifications: next.length > 0 ? next : [emptySpecification()],
            };
        });
    };

    const buildCorePayload = () => ({
        title: form.title,
        brand: form.brand,
        category: form.category,
        subCategory: form.subCategory,
        description: form.description,
        image: form.image,
        countInStock: Number(form.countInStock || 0),
        deliveryTime: form.deliveryTime,
        warranty: form.warranty,
        highlights: sanitizeHighlights(form.highlightsText),
        specifications: sanitizeSpecifications(form.specifications),
        reason: String(form.coreReason || '').trim() || t('admin.productEdit.notes.coreUpdate', {}, 'Admin core update'),
    });

    const buildPricingPayload = () => ({
        price: Number(form.price || 0),
        originalPrice: Number(form.originalPrice || 0),
        discountPercentage: Number(form.discountPercentage || 0),
        reason: String(form.pricingReason || '').trim() || t('admin.productEdit.notes.pricingUpdate', {}, 'Admin pricing update'),
    });

    const validateForm = () => {
        if (!form.title.trim() || !form.brand.trim() || !form.category.trim()) {
            toast.error(t('admin.productEdit.error.requiredFields', {}, 'Title, brand, and category are required'));
            return false;
        }
        if (!form.image.trim()) {
            toast.error(t('admin.productEdit.error.imageRequired', {}, 'Image URL is required'));
            return false;
        }
        if (Number(form.price) < 0 || Number(form.originalPrice) < 0) {
            toast.error(t('admin.productEdit.error.priceNonNegative', {}, 'Price values must be non-negative'));
            return false;
        }
        if (Number(form.price) > Number(form.originalPrice || form.price)) {
            toast.error(t('admin.productEdit.error.priceBounds', {}, 'Selling price cannot be greater than original price'));
            return false;
        }
        return true;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!validateForm()) return;

        try {
            setSaving(true);

            if (isNew) {
                const createPayload = {
                    ...buildCorePayload(),
                    ...buildPricingPayload(),
                    stock: Number(form.countInStock || 0),
                };
                const response = await adminApi.createProduct(createPayload);
                const createdRef = response?.product?.id || response?.product?.externalId || response?.product?._id;
                toast.success(t('admin.productEdit.success.created', {}, 'Product created'));
                if (createdRef) {
                    navigate(`/admin/product/${encodeURIComponent(String(createdRef))}/edit`);
                    return;
                }
                navigate('/admin/products');
                return;
            }

            await adminApi.updateProductCore(id, buildCorePayload());
            if (pricingChanged) {
                await adminApi.updateProductPricing(id, buildPricingPayload());
                setInitialPricing(pricingSnapshotFromForm(form));
            }

            toast.success(t('admin.productEdit.success.updated', {}, 'Product updated'));
            setForm((prev) => ({ ...prev, coreReason: '', pricingReason: '' }));
            await Promise.all([loadProduct(), loadLogs()]);
        } catch (error) {
            toast.error(error.message || t('admin.productEdit.error.save', {}, 'Failed to save product'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <AdminPremiumShell
                eyebrow={t('admin.productEdit.eyebrow', {}, 'Catalog editor')}
                title={isNew ? t('admin.productEdit.title.create', {}, 'Create product') : t('admin.productEdit.title.editStudio', {}, 'Product edit studio')}
                description={t('admin.productEdit.loadingDescription', {}, 'Refine product details, pricing, and governance notes from a premium edit surface.')}
            >
                <div className="admin-premium-panel p-8 text-center text-slate-400">{t('admin.productEdit.loading', {}, 'Loading product...')}</div>
            </AdminPremiumShell>
        );
    }

    return (
        <AdminPremiumShell
            eyebrow={t('admin.productEdit.eyebrow', {}, 'Catalog editor')}
            title={isNew ? t('admin.productEdit.title.create', {}, 'Create product') : t('admin.productEdit.title.editStudio', {}, 'Product edit studio')}
            description={t('admin.productEdit.description', {}, 'Admin-governed control for core product details, specs, pricing, and audit reasons.')}
        >
        <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <Button variant="ghost" className="w-full md:w-auto" onClick={() => navigate('/admin/products')}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('admin.productEdit.backToProducts', {}, 'Back to Products')}
                </Button>
                {!isNew ? (
                    <div className="text-xs text-slate-500 rounded-lg border px-3 py-2 bg-white">
                        {t('admin.productEdit.metaRow', {
                            id: meta.id || '-',
                            source: meta.source || '-',
                            catalog: meta.catalogVersion || '-',
                            updated: meta.updatedAt ? formatDateTime(meta.updatedAt) : '-',
                        }, `ID: ${meta.id || '-'} | Source: ${meta.source || '-'} | Catalog: ${meta.catalogVersion || '-'} | Updated: ${meta.updatedAt ? formatDateTime(meta.updatedAt) : '-'}`)}
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <form onSubmit={handleSubmit} className="admin-premium-panel xl:col-span-2 space-y-6">
                    <div>
                        <h1 className="text-2xl font-bold">{isNew ? t('admin.productEdit.heading.create', {}, 'Create Product') : t('admin.productEdit.heading.edit', {}, 'Edit Product')}</h1>
                        <p className="text-sm text-slate-500">{t('admin.productEdit.headingBody', {}, 'Admin-governed control for core product details, specs, and pricing.')}</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Field label={t('admin.productEdit.fields.title', {}, 'Title')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.title}
                                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                                required
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.brand', {}, 'Brand')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.brand}
                                onChange={(event) => setForm((prev) => ({ ...prev, brand: event.target.value }))}
                                required
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.category', {}, 'Category')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.category}
                                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                                required
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.subCategory', {}, 'Sub Category')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.subCategory}
                                onChange={(event) => setForm((prev) => ({ ...prev, subCategory: event.target.value }))}
                            />
                        </Field>
                    </div>

                    <Field label={t('admin.productEdit.fields.imageUrl', {}, 'Image URL')}>
                        <input
                            type="url"
                            className={inputClass}
                            value={form.image}
                            onChange={(event) => setForm((prev) => ({ ...prev, image: event.target.value }))}
                            required
                        />
                    </Field>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Field label={t('admin.productEdit.fields.sellingPrice', {}, 'Selling Price (INR)')}>
                            <input
                                type="number"
                                min="0"
                                className={inputClass}
                                value={form.price}
                                onChange={(event) => setForm((prev) => ({ ...prev, price: Number(event.target.value || 0) }))}
                                required
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.originalPrice', {}, 'Original Price (INR)')}>
                            <input
                                type="number"
                                min="0"
                                className={inputClass}
                                value={form.originalPrice}
                                onChange={(event) => setForm((prev) => ({ ...prev, originalPrice: Number(event.target.value || 0) }))}
                                required
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.discount', {}, 'Discount %')}>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                className={inputClass}
                                value={form.discountPercentage}
                                onChange={(event) => setForm((prev) => ({ ...prev, discountPercentage: Number(event.target.value || 0) }))}
                            />
                        </Field>
                    </div>
                    <div className="text-xs text-slate-500">
                        {t('admin.productEdit.effectivePricing', { price: formatPrice(form.price), mrp: formatPrice(form.originalPrice || form.price) }, `Effective pricing: ${formatPrice(form.price)} vs MRP ${formatPrice(form.originalPrice || form.price)}`)}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Field label={t('admin.productEdit.fields.stock', {}, 'Stock')}>
                            <input
                                type="number"
                                min="0"
                                className={inputClass}
                                value={form.countInStock}
                                onChange={(event) => setForm((prev) => ({ ...prev, countInStock: Number(event.target.value || 0) }))}
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.deliveryTime', {}, 'Delivery Time')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.deliveryTime}
                                onChange={(event) => setForm((prev) => ({ ...prev, deliveryTime: event.target.value }))}
                                placeholder={t('admin.productEdit.placeholders.deliveryTime', {}, 'e.g. 2-4 days')}
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.warranty', {}, 'Warranty')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.warranty}
                                onChange={(event) => setForm((prev) => ({ ...prev, warranty: event.target.value }))}
                                placeholder={t('admin.productEdit.placeholders.warranty', {}, 'e.g. 1 year manufacturer warranty')}
                            />
                        </Field>
                    </div>

                    <Field label={t('admin.productEdit.fields.description', {}, 'Description')}>
                        <textarea
                            rows={4}
                            className={inputClass}
                            value={form.description}
                            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                            required
                        />
                    </Field>

                    <Field label={t('admin.productEdit.fields.highlights', {}, 'Highlights (one per line)')}>
                        <textarea
                            rows={4}
                            className={inputClass}
                            value={form.highlightsText}
                            onChange={(event) => setForm((prev) => ({ ...prev, highlightsText: event.target.value }))}
                            placeholder={t('admin.productEdit.placeholders.highlights', {}, 'Fast charging\nPremium build\nWater resistant')}
                        />
                    </Field>

                    <div className="admin-premium-subpanel space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-slate-800">{t('admin.productEdit.specifications', {}, 'Specifications')}</h2>
                            <Button type="button" variant="outline" onClick={addSpecification}>
                                <Plus className="w-4 h-4 mr-2" />
                                {t('admin.productEdit.addSpec', {}, 'Add Spec')}
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {form.specifications.map((entry, index) => (
                                <div key={`spec-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                                    <input
                                        type="text"
                                        className="input md:col-span-4"
                                        placeholder={t('admin.productEdit.placeholders.specKey', {}, 'Key (e.g. Processor)')}
                                        value={entry.key}
                                        onChange={(event) => updateSpecification(index, 'key', event.target.value)}
                                    />
                                    <input
                                        type="text"
                                        className="input md:col-span-7"
                                        placeholder={t('admin.productEdit.placeholders.specValue', {}, 'Value (e.g. Snapdragon 8 Gen 3)')}
                                        value={entry.value}
                                        onChange={(event) => updateSpecification(index, 'value', event.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="rounded-lg border border-rose-200 px-2 py-2 text-rose-700 hover:bg-rose-50 md:col-span-1"
                                        onClick={() => removeSpecification(index)}
                                    >
                                        <Trash2 className="h-4 w-4 mx-auto" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Field label={t('admin.productEdit.fields.coreReason', {}, 'Core Update Reason (Audit)')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.coreReason}
                                onChange={(event) => setForm((prev) => ({ ...prev, coreReason: event.target.value }))}
                                placeholder={t('admin.productEdit.placeholders.coreReason', {}, 'Why core fields changed')}
                            />
                        </Field>
                        <Field label={t('admin.productEdit.fields.pricingReason', {}, 'Pricing Change Reason (Audit)')}>
                            <input
                                type="text"
                                className={inputClass}
                                value={form.pricingReason}
                                onChange={(event) => setForm((prev) => ({ ...prev, pricingReason: event.target.value }))}
                                placeholder={t('admin.productEdit.placeholders.pricingReason', {}, 'Why pricing changed')}
                            />
                        </Field>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} className="w-full md:w-auto">
                            <Save className="w-4 h-4 mr-2" />
                            {saving ? t('admin.productEdit.saving', {}, 'Saving...') : (isNew ? t('admin.productEdit.actions.createProduct', {}, 'Create Product') : t('admin.productEdit.actions.saveChanges', {}, 'Save Changes'))}
                        </Button>
                    </div>
                </form>

                <aside className="admin-premium-panel p-5">
                    <h2 className="text-lg font-semibold text-slate-900">{t('admin.productEdit.timeline.title', {}, 'Governance Timeline')}</h2>
                    <p className="text-xs text-slate-500 mb-4">{t('admin.productEdit.timeline.description', {}, 'Every admin change is tracked for audit and rollback analysis.')}</p>
                    {isNew ? (
                        <p className="text-sm text-slate-500">{t('admin.productEdit.timeline.afterFirstSave', {}, 'Logs appear after first save.')}</p>
                    ) : logsLoading ? (
                        <p className="text-sm text-slate-500">{t('admin.productEdit.timeline.loading', {}, 'Loading logs...')}</p>
                    ) : logs.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('admin.productEdit.timeline.empty', {}, 'No admin changes recorded yet.')}</p>
                    ) : (
                        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                            {logs.map((log) => (
                                <div key={log.actionId} className="admin-premium-subpanel">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatProductLogActionType(t, log.actionType)}</span>
                                        <span className="text-[11px] text-slate-400">
                                            {log.createdAt ? formatDateTime(log.createdAt) : '-'}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-600">{t('admin.productEdit.timeline.by', { actor: log.actorEmail || t('admin.shared.adminActor', {}, 'admin') }, `By: ${log.actorEmail || 'admin'}`)}</p>
                                    <p className="mt-1 text-xs text-slate-700">{log.reason || t('admin.productEdit.timeline.noReason', {}, 'No reason provided')}</p>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                        {t('admin.productEdit.timeline.fieldsChanged', { count: Object.keys(log.changeSet || {}).length }, `Fields changed: ${Object.keys(log.changeSet || {}).length}`)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            </div>
        </div>
        </AdminPremiumShell>
    );
};

function Field({ label, children }) {
    return (
        <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</label>
            {children}
        </div>
    );
}

export default ProductEdit;

