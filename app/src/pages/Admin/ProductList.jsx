import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Edit, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Admin Product Control</h1>
                    <p className="text-sm text-slate-500">Create, update, and govern product specs/pricing with strict admin controls.</p>
                </div>
                <Button onClick={() => navigate('/admin/product/new/edit')} className="w-full lg:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Real Product
                </Button>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</label>
                        <div className="mt-1 flex items-center rounded-lg border px-3">
                            <Search className="w-4 h-4 text-slate-400" />
                            <input
                                value={filters.search}
                                onChange={(event) => onFilterChange('search', event.target.value)}
                                placeholder="Title, brand, category, id"
                                className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</label>
                        <select
                            value={filters.source}
                            onChange={(event) => onFilterChange('source', event.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                        >
                            <option value="">All</option>
                            <option value="manual">Manual</option>
                            <option value="batch">Batch</option>
                            <option value="provider">Provider</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</label>
                        <select
                            value={filters.category}
                            onChange={(event) => onFilterChange('category', event.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                        >
                            <option value="">All</option>
                            {categoryOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brand</label>
                        <select
                            value={filters.brand}
                            onChange={(event) => onFilterChange('brand', event.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                        >
                            <option value="">All</option>
                            {brandOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sort</label>
                        <select
                            value={filters.sort}
                            onChange={(event) => onFilterChange('sort', event.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                        >
                            <option value="newest">Newest</option>
                            <option value="oldest">Oldest</option>
                            <option value="price-asc">Price Low to High</option>
                            <option value="price-desc">Price High to Low</option>
                            <option value="stock-asc">Stock Low to High</option>
                            <option value="stock-desc">Stock High to Low</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <div className="table-responsive">
                    <table className="min-w-[980px] w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Product</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Pricing</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Inventory</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Specs</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Catalog</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Loading products...</td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No products found for current filters.</td>
                                </tr>
                            ) : products.map((product) => {
                                const productRef = resolveProductRef(product);
                                const key = `${product._id || product.id || product.externalId}`;
                                return (
                                    <tr key={key} className="hover:bg-slate-50/80">
                                        <td className="px-4 py-3 align-top">
                                            <div className="flex items-start gap-3">
                                                <img src={product.image} alt="" className="h-12 w-12 rounded object-cover border" />
                                                <div>
                                                    <p className="font-semibold text-slate-900 leading-5">{product.title}</p>
                                                    <p className="text-xs text-slate-500">{product.brand} | {product.category}</p>
                                                    <p className="text-[11px] text-slate-400 mt-1">ID: {product.id || '-'} | {product.externalId || '-'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <p className="font-semibold text-slate-900">{formatPrice(product.price)}</p>
                                            <p className="text-xs text-slate-500">
                                                MRP: {formatPrice(product.originalPrice || product.price)} | Discount: {Number(product.discountPercentage || 0).toFixed(1)}%
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <p className="font-semibold text-slate-900">{Number(product.stock || 0)} units</p>
                                            <p className="text-xs text-slate-500">Updated: {new Date(product.updatedAt || Date.now()).toLocaleString()}</p>
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <p className="text-sm text-slate-700">{Array.isArray(product.specifications) ? product.specifications.length : 0} specs</p>
                                            <p className="text-xs text-slate-500">{Array.isArray(product.highlights) ? product.highlights.length : 0} highlights</p>
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <span className="inline-flex rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                                {product.source || 'manual'}
                                            </span>
                                            <p className="text-[11px] text-slate-500 mt-1">{product.catalogVersion || '-'}</p>
                                        </td>
                                        <td className="px-4 py-3 align-top text-right">
                                            <div className="inline-flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/admin/product/${encodeURIComponent(String(productRef))}/edit`)}
                                                    className="rounded-lg border px-2 py-1 text-blue-700 hover:bg-blue-50"
                                                    title="Edit product"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(product)}
                                                    disabled={busyProductRef === String(productRef)}
                                                    className="rounded-lg border px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
                <p className="text-slate-600">Total {total} products | Page {filters.page} of {pages}</p>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        disabled={filters.page <= 1}
                        onClick={() => onFilterChange('page', filters.page - 1)}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        disabled={filters.page >= pages}
                        onClick={() => onFilterChange('page', filters.page + 1)}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ProductList;

