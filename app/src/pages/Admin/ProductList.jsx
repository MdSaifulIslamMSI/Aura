import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Boxes, Edit, Layers3, Plus, Search, Trash2 } from 'lucide-react';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel } from '@/components/shared/AdminPremiumShell';
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
            toast.error(error.message || 'Failed to load products');
        } finally {
            setLoading(false);
        }
    }, [filters]);

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
        const confirmed = window.confirm(`Delete product "${product?.title || productRef}"? This cannot be undone.`);
        if (!confirmed) return;

        const reason = window.prompt('Delete reason (admin audit):', 'Duplicate/invalid product cleanup');
        if (reason !== null && !String(reason).trim()) {
            toast.error('Delete reason is required for audit trail');
            return;
        }

        try {
            setBusyProductRef(String(productRef));
            await adminApi.deleteProduct(productRef, { reason: String(reason || '').trim() });
            toast.success('Product deleted');
            await fetchProducts();
        } catch (error) {
            toast.error(error.message || 'Failed to delete product');
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
            eyebrow="Catalog command"
            title="Product control studio"
            description="Create, update, and retire catalog inventory with a more polished premium command surface for pricing, source quality, and product governance."
            actions={(
                <button type="button" onClick={() => navigate('/admin/product/new/edit')} className="admin-premium-button admin-premium-button-primary w-full sm:w-auto">
                    <Plus className="h-4 w-4" />
                    Add Real Product
                </button>
            )}
            stats={[
                <AdminHeroStat key="total" label="Visible products" value={total} detail="Items in the current result set" icon={<Boxes className="h-5 w-5" />} />,
                <AdminHeroStat key="pages" label="Pagination" value={pages} detail={`Page ${filters.page} of ${pages}`} icon={<Layers3 className="h-5 w-5" />} />,
                <AdminHeroStat key="search" label="Search state" value={filters.search ? 'Focused' : 'Open'} detail={filters.search || 'Full catalog scope'} icon={<Search className="h-5 w-5" />} />,
            ]}
        >
            <AdminPremiumPanel>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2">
                        <label className="premium-kicker">Search</label>
                        <div className="mt-1 flex items-center rounded-[1.05rem] border border-white/10 bg-white/5 px-3">
                            <Search className="h-4 w-4 text-slate-400" />
                            <input
                                value={filters.search}
                                onChange={(event) => onFilterChange('search', event.target.value)}
                                placeholder="Title, brand, category, id"
                                className="admin-premium-control border-0 bg-transparent px-2 py-2 shadow-none focus:ring-0"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="premium-kicker">Source</label>
                        <select value={filters.source} onChange={(event) => onFilterChange('source', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">All</option>
                            <option value="manual">Manual</option>
                            <option value="batch">Batch</option>
                            <option value="provider">Provider</option>
                        </select>
                    </div>

                    <div>
                        <label className="premium-kicker">Category</label>
                        <select value={filters.category} onChange={(event) => onFilterChange('category', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">All</option>
                            {categoryOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="premium-kicker">Brand</label>
                        <select value={filters.brand} onChange={(event) => onFilterChange('brand', event.target.value)} className="admin-premium-control mt-1">
                            <option value="">All</option>
                            {brandOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="premium-kicker">Sort</label>
                        <select value={filters.sort} onChange={(event) => onFilterChange('sort', event.target.value)} className="admin-premium-control mt-1">
                            <option value="newest">Newest</option>
                            <option value="oldest">Oldest</option>
                            <option value="price-asc">Price Low to High</option>
                            <option value="price-desc">Price High to Low</option>
                            <option value="stock-asc">Stock Low to High</option>
                            <option value="stock-desc">Stock High to Low</option>
                        </select>
                    </div>
                </div>
            </AdminPremiumPanel>

            <div className="admin-premium-table-shell">
                <div className="table-responsive admin-premium-scroll">
                    <table className="admin-premium-table min-w-[980px]">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Pricing</th>
                                <th>Inventory</th>
                                <th>Specs</th>
                                <th>Catalog</th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">Loading products...</td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No products found for current filters.</td>
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
                                                    <p className="admin-premium-text-muted mt-1 text-[11px]">ID: {product.id || '-'} | {product.externalId || '-'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text-strong font-semibold">{formatPrice(product.price)}</p>
                                            <p className="admin-premium-text text-xs">
                                                MRP: {formatPrice(product.originalPrice || product.price)} | Discount: {Number(product.discountPercentage || 0).toFixed(1)}%
                                            </p>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text-strong font-semibold">{Number(product.stock || 0)} units</p>
                                            <p className="admin-premium-text text-xs">Updated: {new Date(product.updatedAt || Date.now()).toLocaleString()}</p>
                                        </td>
                                        <td>
                                            <p className="admin-premium-text text-sm">{Array.isArray(product.specifications) ? product.specifications.length : 0} specs</p>
                                            <p className="admin-premium-text text-xs">{Array.isArray(product.highlights) ? product.highlights.length : 0} highlights</p>
                                        </td>
                                        <td>
                                            <span className="admin-premium-tag">{product.source || 'manual'}</span>
                                            <p className="admin-premium-text-muted mt-1 text-[11px]">{product.catalogVersion || '-'}</p>
                                        </td>
                                        <td className="text-right">
                                            <div className="inline-flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/admin/product/${encodeURIComponent(String(productRef))}/edit`)}
                                                    className="admin-premium-button px-3 py-2"
                                                    title="Edit product"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(product)}
                                                    disabled={busyProductRef === String(productRef)}
                                                    className="admin-premium-button admin-premium-button-danger px-3 py-2"
                                                    title="Delete product"
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
                <p className="admin-premium-text">Total {total} products | Page {filters.page} of {pages}</p>
                <div className="flex items-center gap-2">
                    <button type="button" className="admin-premium-button" disabled={filters.page <= 1} onClick={() => onFilterChange('page', filters.page - 1)}>
                        Previous
                    </button>
                    <button type="button" className="admin-premium-button" disabled={filters.page >= pages} onClick={() => onFilterChange('page', filters.page + 1)}>
                        Next
                    </button>
                </div>
            </div>
        </AdminPremiumShell>
    );
};

export default ProductList;
