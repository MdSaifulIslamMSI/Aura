import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, ioMock, socketInstances } = vi.hoisted(() => {
    const sharedSocketInstances = [];
    const sharedAuthState = {
        currentUser: {
            getIdToken: vi.fn(),
        },
        loading: false,
    };
    const sharedIoMock = vi.fn((origin, options) => {
        const handlers = new Map();
        const socket = {
            on: vi.fn((eventName, handler) => {
                handlers.set(eventName, handler);
                if (eventName === 'connect') {
                    queueMicrotask(() => handler());
                }
            }),
            disconnect: vi.fn(() => {
                const handler = handlers.get('disconnect');
                if (handler) {
                    handler('io client disconnect');
                }
            }),
        };

        sharedSocketInstances.push({ origin, options, socket });
        return socket;
    });

    return {
        authState: sharedAuthState,
        ioMock: sharedIoMock,
        socketInstances: sharedSocketInstances,
    };
});

authState.loading = false;
authState.currentUser = {
    getIdToken: vi.fn(),
};

vi.mock('socket.io-client', () => ({
    io: ioMock,
}));

vi.mock('./AuthContext', () => ({
    useAuth: () => authState,
}));

vi.mock('../services/runtimeApiConfig', () => ({
    resolveServiceOrigin: vi.fn(() => 'https://api.example.test'),
}));

vi.stubEnv('VITE_ENABLE_REALTIME_SOCKET', 'true');

const { SocketProvider, useSocketDemand } = await import('./SocketContext');

const DemandProbe = ({ extraDemand = false }) => {
    useSocketDemand('video-calls-global', true);
    useSocketDemand('support-screen', extraDemand);
    return null;
};

describe('SocketProvider', () => {
    beforeEach(() => {
        ioMock.mockClear();
        socketInstances.length = 0;
        authState.loading = false;
        authState.currentUser = {
            getIdToken: vi.fn().mockResolvedValue('socket-token'),
        };
    });

    it('keeps the same socket connection while realtime demand keys change', async () => {
        const view = render(
            <SocketProvider>
                <DemandProbe extraDemand={false} />
            </SocketProvider>
        );

        await waitFor(() => {
            expect(ioMock).toHaveBeenCalledTimes(1);
        });

        const firstSocket = socketInstances[0]?.socket;
        expect(firstSocket).toBeTruthy();

        view.rerender(
            <SocketProvider>
                <DemandProbe extraDemand />
            </SocketProvider>
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(ioMock).toHaveBeenCalledTimes(1);
        expect(firstSocket.disconnect).not.toHaveBeenCalled();

        view.rerender(
            <SocketProvider>
                <DemandProbe extraDemand={false} />
            </SocketProvider>
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(ioMock).toHaveBeenCalledTimes(1);
        expect(firstSocket.disconnect).not.toHaveBeenCalled();
    });
});
