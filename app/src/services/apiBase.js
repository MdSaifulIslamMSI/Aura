export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const buildApiUrl = (path = '') => {
    const normalizedPath = String(path || '').startsWith('/')
        ? String(path || '')
        : `/${String(path || '')}`;

    return `${API_BASE_URL}${normalizedPath}`;
};
