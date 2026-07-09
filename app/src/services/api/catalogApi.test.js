import { afterEach, describe, expect, it, vi } from 'vitest';
import { productApi } from './catalogApi';

describe('catalogApi desktop public catalog bridge fallback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete window.auraDesktop;
    });

    it('uses the desktop public catalog bridge when product listing fetch is unreachable', async () => {
        const fetchPublicCatalog = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            data: {
                products: [{ id: 400046981, title: 'Live product' }],
                total: 1,
            },
        });
        window.auraDesktop = {
            isDesktop: true,
            fetchPublicCatalog,
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

        const data = await productApi.getProducts({ page: 1, limit: 12 });

        expect(data.products).toHaveLength(1);
        expect(data.total).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchPublicCatalog).toHaveBeenCalledWith({
            path: '/products',
            params: { page: 1, limit: 12 },
        });
    });

    it('uses the desktop public catalog bridge when product detail fetch is unreachable', async () => {
        const fetchPublicCatalog = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            data: {
                id: 400046981,
                title: 'Live product detail',
            },
        });
        window.auraDesktop = {
            isDesktop: true,
            fetchPublicCatalog,
        };
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

        const data = await productApi.getProductById('400046981', { force: true });

        expect(data).toMatchObject({
            id: 400046981,
            title: 'Live product detail',
        });
        expect(fetchPublicCatalog).toHaveBeenCalledWith({
            path: '/products/400046981',
            params: {},
        });
    });

    it('does not hide HTTP failures behind the desktop bridge', async () => {
        const fetchPublicCatalog = vi.fn();
        window.auraDesktop = {
            isDesktop: true,
            fetchPublicCatalog,
        };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                message: 'Origin not allowed by CORS policy',
                requestId: 'srv-cors',
            }), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-cors',
                },
            })
        );

        await expect(productApi.getProducts({ page: 1 })).rejects.toMatchObject({
            status: 403,
            serverRequestId: 'srv-cors',
        });
        expect(fetchPublicCatalog).not.toHaveBeenCalled();
    });
});
