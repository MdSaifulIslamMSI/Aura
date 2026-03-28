import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import ClientDiagnosticsPanel from './ClientDiagnosticsPanel';
import { adminApi } from '@/services/api';

vi.mock('@/services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        adminApi: {
            ...actual.adminApi,
            getClientDiagnostics: vi.fn(),
        },
    };
});

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
    },
}));

describe('ClientDiagnosticsPanel', () => {
    const renderWithMarket = (ui) => render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
            {ui}
        </MarketProvider>
    );

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads persisted diagnostics on mount and renders key references', async () => {
        adminApi.getClientDiagnostics.mockResolvedValue({
            source: 'mongo',
            count: 1,
            diagnostics: [
                {
                    _id: 'diag-1',
                    type: 'api.network_error',
                    severity: 'error',
                    requestId: 'req-123',
                    serverRequestId: 'srv-123',
                    sessionId: 'session-1',
                    route: '/products?category=electronics',
                    method: 'GET',
                    url: 'http://127.0.0.1:5173/api/products?category=electronics',
                    status: 500,
                    durationMs: 1200,
                    timestamp: '2026-03-08T18:00:00.000Z',
                    ingestedAt: '2026-03-08T18:00:05.000Z',
                    error: { message: 'connect ECONNREFUSED 127.0.0.1:5000' },
                },
            ],
        });

        renderWithMarket(<ClientDiagnosticsPanel />);

        expect(await screen.findByText('Client Diagnostics')).toBeInTheDocument();
        expect(await screen.findByText('api.network_error')).toBeInTheDocument();
        expect(screen.getByText(/Request: req-123/i)).toBeInTheDocument();
        expect(screen.getByText(/Server: srv-123/i)).toBeInTheDocument();
        expect(screen.getAllByText(/connect ECONNREFUSED/i)).toHaveLength(2);

        expect(adminApi.getClientDiagnostics).toHaveBeenCalledWith({ limit: '25' });
    });

    it('applies filters and refetches with the selected query params', async () => {
        adminApi.getClientDiagnostics
            .mockResolvedValueOnce({
                source: 'mongo',
                count: 1,
                diagnostics: [
                    {
                        _id: 'diag-1',
                        type: 'api.network_error',
                        severity: 'error',
                        requestId: 'req-1',
                        timestamp: '2026-03-08T18:00:00.000Z',
                    },
                ],
            })
            .mockResolvedValueOnce({
                source: 'mongo',
                count: 1,
                diagnostics: [
                    {
                        _id: 'diag-2',
                        type: 'api.response_error',
                        severity: 'warning',
                        requestId: 'req-filtered',
                        route: '/products',
                        sessionId: 'sess-filtered',
                        timestamp: '2026-03-08T19:00:00.000Z',
                    },
                ],
            });

        renderWithMarket(<ClientDiagnosticsPanel />);

        await screen.findByText('api.network_error');

        fireEvent.click(screen.getByLabelText('Severity'));
        fireEvent.click(screen.getByRole('option', { name: /warning/i }));

        fireEvent.change(screen.getByLabelText('Type'), {
            target: { value: 'api.response_error' },
        });
        fireEvent.change(screen.getByLabelText('Request ID'), {
            target: { value: 'req-filtered' },
        });
        fireEvent.change(screen.getByLabelText('Session'), {
            target: { value: 'sess-filtered' },
        });
        fireEvent.change(screen.getByLabelText('Route Contains'), {
            target: { value: '/products' },
        });

        fireEvent.click(screen.getByLabelText('Limit'));
        fireEvent.click(screen.getByRole('option', { name: /^50$/ }));

        fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

        await waitFor(() => {
            expect(adminApi.getClientDiagnostics).toHaveBeenNthCalledWith(2, {
                limit: '50',
                severity: 'warning',
                type: 'api.response_error',
                requestId: 'req-filtered',
                sessionId: 'sess-filtered',
                route: '/products',
            });
        });

        expect(await screen.findByText('api.response_error')).toBeInTheDocument();
        expect(screen.getByText(/Request: req-filtered/i)).toBeInTheDocument();
    });
});
