import { createContext, useState, useEffect, useContext } from 'react';
import { productApi } from '../services/api';

export const ProductContext = createContext();

export const useProduct = () => useContext(ProductContext);

export const ProductProvider = ({ children }) => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Context no longer auto-fetches. 
    // Components must fetch their own data (Hyperscale Architecture).
    useEffect(() => {
        setLoading(false);
    }, []);

    const getProductById = (id) => {
        return products.find(p => p.id === parseInt(id));
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
