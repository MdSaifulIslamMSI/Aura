import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, getAuthHeaderMock } = vi.hoisted(() => ({
    apiFetchMock: vi.fn(),
    getAuthHeaderMock: vi.fn(),
}));

let recommendationApi;

describe('recommendationApi optional auth requests', () => {
    beforeEach(async () => {
        vi.resetModules();
        window.localStorage.clear();
        apiFetchMock.mockReset();
        getAuthHeaderMock.mockReset();
        apiFetchMock.mockResolvedValue({
            data: {
                recommendations: [],
            },
        });

        vi.doMock('../apiBase', () => ({
            API_BASE_URL: 'https://api.example.test/api',
            apiFetch: apiFetchMock,
        }));
        vi.doMock('./apiUtils', () => ({
            getAuthHeader: getAuthHeaderMock,
        }));

        ({ recommendationApi } = await import('./recommendationApi'));
    });

    it('omits cookies for anonymous optional-auth recommendation calls', async () => {
        getAuthHeaderMock.mockResolvedValue({
            'X-Trusted-Device-Session': 'device-session',
        });

        await recommendationApi.getHomeRecommendations({ limit: 6 });

        expect(apiFetchMock).toHaveBeenCalledWith('/recommendations/home', expect.objectContaining({
            credentials: 'omit',
            headers: {
                'X-Trusted-Device-Session': 'device-session',
            },
            params: expect.objectContaining({
                limit: 6,
                sessionId: expect.any(String),
            }),
        }));
    });

    it('keeps credentials available for bearer-authenticated recommendation calls', async () => {
        getAuthHeaderMock.mockResolvedValue({
            Authorization: 'Bearer fresh-token',
        });

        await recommendationApi.getHomeRecommendations({ limit: 6 });

        expect(apiFetchMock).toHaveBeenCalledWith('/recommendations/home', expect.objectContaining({
            credentials: 'include',
            headers: {
                Authorization: 'Bearer fresh-token',
            },
        }));
    });
});
