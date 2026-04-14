import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackendStatusBanner from './BackendStatusBanner';
import { MarketProvider } from '@/context/MarketContext';
import { pushClientDiagnostic } from '@/services/clientObservability';
import * as backendHealth from '@/services/backendHealth';

const renderBanner = () => render(
  <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
    <BackendStatusBanner />
  </MarketProvider>
);

describe('BackendStatusBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('displays degraded status when backend reports database disconnection', async () => {
    vi.spyOn(backendHealth, 'getBackendHealthSnapshot').mockResolvedValue({
      status: 'degraded',
      startupHealthy: false,
      timestamp: new Date().toISOString(),
      uptime: 12,
    });

    renderBanner();

    expect(await screen.findByText('Some secure actions may be slower right now')).toBeInTheDocument();
    expect(screen.getByText(/Browsing should continue normally/i)).toBeInTheDocument();
    expect(screen.queryByText(/Debug Ref srv-health-1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/database_disconnected/i)).not.toBeInTheDocument();
  });

  it('softens a single proxy failure diagnostic into a warming state and clears after a healthy retry', async () => {
    vi.spyOn(backendHealth, 'getBackendHealthSnapshot').mockResolvedValue({
      status: 'ok',
      startupHealthy: true,
      timestamp: new Date().toISOString(),
      uptime: 12,
    });

    renderBanner();

    await waitFor(() => {
      expect(screen.queryByText('Backend unavailable')).not.toBeInTheDocument();
    });

    await act(async () => {
      pushClientDiagnostic('api.response_error', {
        url: 'http://127.0.0.1:5173/health',
        requestId: 'req-proxy-1',
        serverRequestId: 'req-proxy-1',
        status: 500,
        error: {
          message: 'Internal Server Error',
        },
      }, 'error');
    });

    expect(await screen.findByText('Secure services are reconnecting')).toBeInTheDocument();
    expect(screen.getByText(/Please wait a few seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/Debug Ref req-proxy-1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HTTP 500/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check again/i }));

    await waitFor(() => {
      expect(screen.queryByText('Secure services are reconnecting')).not.toBeInTheDocument();
    });
  });

  it('showns recovery status when connectivity is restored', async () => {
    const requestMock = vi.spyOn(backendHealth, 'getBackendHealthSnapshot').mockResolvedValue({
      status: 'ok',
      startupHealthy: true,
      timestamp: new Date().toISOString(),
      uptime: 12,
    });

    renderBanner();

    // Wait for initial health check
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryByText('Backend unavailable')).not.toBeInTheDocument();
    });

    // Reset mock to track only retry calls
    requestMock.mockClear();

    await act(async () => {
      pushClientDiagnostic('api.network_error', {
        url: 'http://127.0.0.1:5173/health',
        requestId: 'req-recover-1',
        serverRequestId: 'req-recover-1',
        status: 0,
        error: {
          message: 'connect ECONNREFUSED 127.0.0.1:5000',
        },
      }, 'error');
    });

    // Let async operations settle
    await act(async () => {});

    expect(await screen.findByText('Secure services are reconnecting')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check again/i }));

    // Let async operations settle
    await act(async () => {});

    await waitFor(() => {
      expect(screen.queryByText('Secure services are reconnecting')).not.toBeInTheDocument();
    });

    // Should only have 1 call from the retry button click
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('escalates repeated transient wake-up failures into an unavailable banner', async () => {
    vi.spyOn(backendHealth, 'getBackendHealthSnapshot').mockResolvedValue({
      status: 'ok',
      startupHealthy: true,
      timestamp: new Date().toISOString(),
      uptime: 12,
    });

    renderBanner();

    await waitFor(() => {
      expect(screen.queryByText('Backend unavailable')).not.toBeInTheDocument();
    });

    const eventPayload = {
      url: 'http://127.0.0.1:5173/health',
      requestId: 'req-wakeup-1',
      serverRequestId: 'req-wakeup-1',
      status: 0,
      error: {
        message: 'Failed to fetch',
      },
    };

    await act(async () => {
      pushClientDiagnostic('api.network_error', eventPayload, 'error');
    });

    expect(await screen.findByText('Secure services are reconnecting')).toBeInTheDocument();

    await act(async () => {
      pushClientDiagnostic('api.network_error', {
        ...eventPayload,
        requestId: 'req-wakeup-2',
        serverRequestId: 'req-wakeup-2',
      }, 'error');
    });

    expect(await screen.findByText('Secure services are reconnecting')).toBeInTheDocument();

    await act(async () => {
      pushClientDiagnostic('api.network_error', {
        ...eventPayload,
        requestId: 'req-wakeup-3',
        serverRequestId: 'req-wakeup-3',
      }, 'error');
    });

    expect(await screen.findByText("We're reconnecting secure services")).toBeInTheDocument();
    expect(screen.getAllByText(/temporarily unavailable/i).length).toBeGreaterThan(0);
  });
});
