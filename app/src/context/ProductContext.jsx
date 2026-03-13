import { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { productApi } from '../services/api';

export const ProductContext = createContext();

export const useProduct = () => useContext(ProductContext);

export const ProductProvider = ({ children }) => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await productApi.getProducts();
            setProducts(Array.isArray(data) ? data : (data?.products || []));
            setError(null);
        } catch (err) {
            setError('Failed to fetch products');
            console.error('Product fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    const getProductById = (id) => {
        return products.find(p => String(p.id) === String(id));
    };

    const getProductsByCategory = (category) => {
        return products.filter(p => p.category === category);
    };

    const searchProducts = (query) => {
        if (!query) return products;
        const lowerQuery = query.toLowerCase();
        return products.filter(p =>
            p.title.toLowerCase().includes(lowerQuery) ||
            p.description.toLowerCase().includes(lowerQuery) ||
            p.brand.toLowerCase().includes(lowerQuery)
        );
    };

    const value = {
        products,
        loading,
        error,
        fetchProducts,
        getProductById,
        getProductsByCategory,
        searchProducts
    };

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};
