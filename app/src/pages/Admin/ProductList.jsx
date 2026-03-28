import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Boxes, Edit, Layers3, Plus, Search, Trash2 } from 'lucide-react';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { adminApi } from '@/services/api';
import { formatPrice } from '@/utils/format';

const DEFAULT_FILTERS = {
    search: '',
    source: '',
    category: '',
    brand: '',
    sort: 'newest',
    page: 1,
    limit: 25,
};

const resolveProductRef = (product) => product?.id || product?.externalId || product?._id;

const ProductList = () => {
    const navigate = useNavigate();
    const { t, formatDateTime } = useMarket();
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [busyProductRef, setBusyProductRef] = useState('');

    const fetchProducts = useCallback(async () => {
        try {
            setLoading(true);
            const response = await adminApi.getProducts(filters);
            setProducts(Array.isArray(response?.products) ? response.products : []);
            setTotal(Number(response?.total || 0));
            setPages(Math.max(1, Number(response?.pages || 1)));
        } catch (error) {
            toast.error(error.message || t('admin.products.error.load', {}, 'Failed to load products'));
        } finally {
            setLoading(false);
        }
    }, [filters, t]);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    const categoryOptions = useMemo(() => {
        const unique = new Set();
        products.forEach((product) => {
            if (product?.category) unique.add(product.category);
        });
        return [...unique].sort((a, b) => a.localeCompare(b));
    }, [products]);

    const brandOptions = useMemo(() => {
        const unique = new Set();
        products.forEach((product) => {
            if (product?.brand) unique.add(product.brand);
        });
        return [...unique].sort((a, b) => a.localeCompare(b));
    }, [products]);

    const handleDelete = async (product) => {
        const productRef = resolveProductRef(product);
        if (!productRef) return;
        const confirmed = window.confirm(
            t(
                'admin.products.confirmDelete',
                { title: product?.title || productRef },
                `Delete product "${product?.title || productRef}"? This cannot be undone.`
            )
        );
        if (!confirmed) return;

        const reason = window.prompt(
            t('admin.products.deleteReasonPrompt', {}, 'Delete reason (admin audit):'),
            t('admin.products.deleteReasonDefault', {}, 'Duplicate/invalid product cleanup')
        );
        if (reason !== null && !String(reason).trim()) {
            toast.error(t('admin.products.error.deleteReasonRequired', {}, 'Delete reason is required for audit trail'));
            return;
        }

        try {
            setBusyProductRef(String(productRef));
            await adminApi.deleteProduct(productRef, { reason: String(reason || '').trim() });
            toast.success(t('admin.products.success.deleted', {}, 'Product deleted'));
            await fetchProducts();
        } catch (error) {
            toast.error(error.message || t('admin.products.error.delete', {}, 'Failed to delete product'));
        } finally {
            setBusyProductRef('');
        }
    };

    const onFilterChange = (field, value) => {
        setFilters((prev) => ({
            ...prev,
            [field]: value,
            page: field === 'page' ? value : 1,
        }));
    };

    return (
        <AdminPremiumShell
            eyebrow={t('admin.products.eyebrow', {}, 'Catalog command')}
            title={t('admin.products.title', {}, 'Product control studio')}
            description={t('admin.products.description', {}, 'Create, update, and retire catalog inventory with a more polished premium command surface for pricing, source quality, and product governance.')}
            actions={(
                <button type="button" onClick={() => navigate('/admin/product/new/edit')} className="admin-premium-button admin-premium-button-primary w-full sm:w-auto">
                    <Plus className="h-4 w-4" />
                    {t('admin.products.addRealProduct', {}, 'Add Real Product')}
                </button>
            )}
            stats={[
                <AdminHeroStat
                    key="total"
                    label={t('admin.products.stats.visibleProducts', {}, 'Visible products')}
                    value={total}
                    detail={t('admin.products.stats.resultSet', {}, 'Items in the current result set')}
                    icon={<Boxes className="h-5 w-5" />}
                />,
                <AdminHeroStat
                    key="pages"
                    label={t('admin.products.stats.pagination', {}, 'Pagination')}
                    value={pages}
                    detail={t('admin.products.stats.pageOf', { page: filters.page, total: pages }, `Page ${filters.page} of ${pages}`)}
                    icon={<Layers3 className="h-5 w-5" />}
                />,
                <AdminHeroStat
                    key="search"
                    label={t('admin.products.stats.searchState', {}, 'Search state')}
                    value={filters.search ? t('admin.products.state.focused', {}, 'Focused') : t('admin.products.state.open', {}, 'Open')}
                    detail={filters.search || t('admin.products.scope.fullCatalog', {}, 'Full catalog scope')}
                    icon={<Search className="h-5 w-5" />}
                />,
            ]}
        >
            <AdminPremiumPanel>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2">
                        <label className="premium-kicker">{t('admin.products.filters.search', {}, 'Search')}</label>
                        <div className="mt-1 flex items-center rounded-[1.05rem] border border-white/10 bg-white/5 px-3">
                            <Search className="h-4 w-4 text-slate-400" />
                            <input
                                value={filters.search}
                                onChange={(event) => onFilterChange('search', event.target.value)}
                                placeholder={t('admin.products.filters.searchPlaceholder', {}, 'Title, brand, category, id')}
                                className="admin-premium-control border-0 bg-transparent px-2 py-2 shadow-none focus:ring-0"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="premium-kicker">{t('admin.products.filters.source', {}, 'Source')}</label>
                        <PremiumSelect value={filters.source} onChange={(event) => onFilterChange('source', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">{t('admin.shared.all', {}, 'All')}</option>
                            <option value="manual">{t('admin.products.source.manual', {}, 'Manual')}</option>
                            <option value="batch">{t('admin.products.source.batch', {}, 'Batch')}</option>
                            <option value="provider">{t('admin.products.source.provider', {}, 'Provider')}</option>
                        </PremiumSelect>
                    </div>

                    <div>
                        <label className="premium-kicker">{t('admin.products.filters.category', {}, 'Category')}</label>
                        <PremiumSelect value={filters.category} onChange={(event) => onFilterChange('category', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">{t('admin.shared.all', {}, 'All')}</option>
                            {categoryOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </PremiumSelect>
                    </div>

                    <div>
                        <label className="premium-kicker">{t('admin.products.filters.brand', {}, 'Brand')}</label>
                        <PremiumSelect value={filters.brand} onChange={(event) => onFilterChange('brand', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">{t('admin.shared.all', {}, 'All')}</option>
                            {brandOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </PremiumSelect>
                    </div>

                    <div>
                        <label className="premium-kicker">{t('admin.products.filters.sort', {}, 'Sort')}</label>
                        <PremiumSelect value={filters.sort} onChange={(event) => onFilterChange('sort', event.target.value)} className="admin-premium-control mt-1">
                            <option value="newest">{t('admin.shared.sort.newest', {}, 'Newest')}</option>
                            <option value="oldest">{t('admin.shared.sort.oldest', {}, 'Oldest')}</option>
                            <option value="price-asc">{t('admin.shared.sort.priceAsc', {}, 'Price Low to High')}</option>
                            <option value="price-desc">{t('admin.shared.sort.priceDesc', {}, 'Price High to Low')}</option>
                            <option value="stock-asc">{t('admin.products.sort.stockAsc', {}, 'Stock Low to High')}</option>
                            <option value="stock-desc">{t('admin.products.sort.stockDesc', {}, 'Stock High to Low')}</option>
                        </PremiumSelect>
                    </div>
                </div>
            </AdminPremiumPanel>

            <div className="admin-premium-table-shell">
                <div className="table-responsive admin-premium-scroll">
                    <table className="admin-premium-table min-w-[980px]">
                        <thead>
                            <tr>
                                <th>{t('admin.products.table.product', {}, 'Product')}</th>
                                <th>{t('admin.products.table.pricing', {}, 'Pricing')}</th>
                                <th>{t('admin.products.table.inventory', {}, 'Inventory')}</th>
                                <th>{t('admin.products.table.specs', {}, 'Specs')}</th>
                                <th>{t('admin.products.table.catalog', {}, 'Catalog')}</th>
                                <th className="text-right">{t('admin.shared.actions', {}, 'Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">{t('admin.products.loading', {}, 'Loading products...')}</td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">{t('admin.products.empty', {}, 'No products found for current filters.')}</td>
                                </tr>
                            ) : products.map((product) => {
                                const productRef = resolveProductRef(product);
                                const key = `${product._id || product.id || product.externalId}`;
                                return (
                                    <tr key={key}>
                                        <td>
                                            <div className="flex items-start gap-3">
                                                <img src={product.image} alt="" className="h-12 w-12 rounded-xl border border-white/10 object-cover" />
                                                <div>
                                                    <p className="admin-premium-text-strong font-semibold leading-5">{product.title}</p>
                                                    <p className="admin-premium-text text-xs">{product.brand} | {product.category}</p>
                                                    <p className="admin-premium-text-muted mt-1 text-[11px]">
                                                        {t('admin.products.meta.idRow', { id: product.id || '-', externalId: product.externalId || '-' }, `ID: ${product.id || '-'} | ${product.externalId || '-'}`)}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text-strong font-semibold">{formatPrice(product.price)}</p>
                                            <p className="admin-premium-text text-xs">
                                                {t(
                                                    'admin.products.meta.pricingRow',
                                                    {
                                                        mrp: formatPrice(product.originalPrice || product.price),
                                                        discount: Number(product.discountPercentage || 0).toFixed(1),
                                                    },
                                                    `MRP: ${formatPrice(product.originalPrice || product.price)} | Discount: ${Number(product.discountPercentage || 0).toFixed(1)}%`
                                                )}
                                            </p>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text-strong font-semibold">
                                                {t('admin.products.meta.units', { count: Number(product.stock || 0) }, `${Number(product.stock || 0)} units`)}
                                            </p>
                                            <p className="admin-premium-text text-xs">
                                                {t('admin.products.meta.updated', { time: formatDateTime(product.updatedAt || Date.now()) }, `Updated: ${formatDateTime(product.updatedAt || Date.now())}`)}
                                            </p>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text text-sm">
                                                {t('admin.products.meta.specCount', { count: Array.isArray(product.specifications) ? product.specifications.length : 0 }, `${Array.isArray(product.specifications) ? product.specifications.length : 0} specs`)}
                                            </p>
                                            <p className="admin-premium-text text-xs">
                                                {t('admin.products.meta.highlightCount', { count: Array.isArray(product.highlights) ? product.highlights.length : 0 }, `${Array.isArray(product.highlights) ? product.highlights.length : 0} highlights`)}
                                            </p>
                                        </td>
                                        <td>
                                            <span className="admin-premium-tag">{product.source || t('admin.products.source.manual', {}, 'manual')}</span>
                                            <p className="admin-premium-text-muted mt-1 text-[11px]">{product.catalogVersion || '-'}</p>
                                        </td>
                                        <td className="text-right">
                                            <div className="inline-flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/admin/product/${encodeURIComponent(String(productRef))}/edit`)}
                                                    className="admin-premium-button px-3 py-2"
                                                    title={t('admin.products.actions.edit', {}, 'Edit product')}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(product)}
                                                    disabled={busyProductRef === String(productRef)}
                                                    className="admin-premium-button admin-premium-button-danger px-3 py-2"
                                                    title={t('admin.products.actions.delete', {}, 'Delete product')}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="admin-premium-text">
                    {t('admin.products.footer.totalPage', { total, page: filters.page, pages }, `Total ${total} products | Page ${filters.page} of ${pages}`)}
                </p>
                <div className="flex items-center gap-2">
                    <button type="button" className="admin-premium-button" disabled={filters.page <= 1} onClick={() => onFilterChange('page', filters.page - 1)}>
                        {t('admin.shared.previous', {}, 'Previous')}
                    </button>
                    <button type="button" className="admin-premium-button" disabled={filters.page >= pages} onClick={() => onFilterChange('page', filters.page + 1)}>
                        {t('admin.shared.next', {}, 'Next')}
                    </button>
                </div>
            </div>
        </AdminPremiumShell>
    );
};

export default ProductList;
