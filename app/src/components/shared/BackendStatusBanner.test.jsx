import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackendStatusBanner from './BackendStatusBanner';
import { pushClientDiagnostic } from '@/services/clientObservability';
import * as apiBase from '@/services/apiBase';

describe('BackendStatusBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('displays degraded status when backend reports database disconnection', async () => {
    vi.spyOn(apiBase, 'requestWithTrace').mockResolvedValue(
      new Response(JSON.stringify({
        status: 'degraded',
        reason: 'database_disconnected',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'srv-health-1',
        },
      })
    );

    render(<BackendStatusBanner />);

    expect(await screen.findByText('Backend health degraded')).toBeInTheDocument();
    expect(screen.getByText(/Debug Ref srv-health-1/i)).toBeInTheDocument();
    expect(screen.getByText(/database_disconnected/i)).toBeInTheDocument();
  });

  it('reacts to proxy failure diagnostics with a client debug reference', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'srv-health-ok',
        },
      })
    );

    render(<BackendStatusBanner />);

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

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Debug Ref req-proxy-1/i)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
  });

  it('showns recovery status when connectivity is restored', async () => {
    const requestMock = vi.spyOn(apiBase, 'requestWithTrace').mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'srv-health-ok',
        },
      })
    ));

    render(<BackendStatusBanner />);

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

    expect(await screen.findByText('Backend waking up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry check/i }));

    // Let async operations settle
    await act(async () => {});

    await waitFor(() => {
      expect(screen.queryByText('Backend waking up')).not.toBeInTheDocument();
    });

    // Should only have 1 call from the retry button click
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('escalates repeated transient wake-up failures into an unavailable banner', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'srv-health-ok',
        },
      })
    );

    render(<BackendStatusBanner />);

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

    expect(await screen.findByText('Backend waking up')).toBeInTheDocument();

    await act(async () => {
      pushClientDiagnostic('api.network_error', {
        ...eventPayload,
        requestId: 'req-wakeup-2',
        serverRequestId: 'req-wakeup-2',
      }, 'error');
    });

    expect(await screen.findByText('Backend waking up')).toBeInTheDocument();

    await act(async () => {
      pushClientDiagnostic('api.network_error', {
        ...eventPayload,
        requestId: 'req-wakeup-3',
        serverRequestId: 'req-wakeup-3',
      }, 'error');
    });

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
  });
});
