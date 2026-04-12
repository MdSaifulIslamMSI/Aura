import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, ioMock, socketInstances } = vi.hoisted(() => {
    const sharedSocketInstances = [];
    const sharedAuthState = {
        currentUser: { uid: 'socket-user-1' },
        loading: false,
    };
    const sharedIoMock = vi.fn((origin, options) => {
        const socketHandlers = new Map();
        const managerHandlers = new Map();
        const socket = {
            auth: options?.auth || null,
            connected: false,
            io: {
                opts: { auth: options?.auth || null },
                on: vi.fn((eventName, handler) => {
                    managerHandlers.set(eventName, handler);
                }),
                off: vi.fn((eventName) => {
                    managerHandlers.delete(eventName);
                }),
            },
            on: vi.fn((eventName, handler) => {
                socketHandlers.set(eventName, handler);
            }),
            off: vi.fn((eventName) => {
                socketHandlers.delete(eventName);
            }),
            connect: vi.fn(() => {
                socket.connected = true;
                const handler = socketHandlers.get('connect');
                if (handler) {
                    queueMicrotask(() => handler());
                }
            }),
            disconnect: vi.fn(() => {
                socket.connected = false;
                const handler = socketHandlers.get('disconnect');
                if (handler) {
                    handler('io client disconnect');
                }
            }),
        };

        sharedSocketInstances.push({ origin, options, socket, socketHandlers, managerHandlers });
        return socket;
    });

    return {
        authState: sharedAuthState,
        ioMock: sharedIoMock,
        socketInstances: sharedSocketInstances,
    };
});

authState.loading = false;
authState.currentUser = { uid: 'socket-user-1' };

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
        authState.currentUser = { uid: 'socket-user-1' };
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

    it('maintains a socket for authenticated users even without explicit demand hooks', async () => {
        render(
            <SocketProvider>
                <div>child</div>
            </SocketProvider>
        );

        await waitFor(() => {
            expect(ioMock).toHaveBeenCalledTimes(1);
        });

        expect(socketInstances[0]?.options?.withCredentials).toBe(true);
        expect(socketInstances[0]?.options?.auth ?? null).toBeNull();
        expect(socketInstances[0]?.socket.connect).toHaveBeenCalledTimes(1);
    });
});
