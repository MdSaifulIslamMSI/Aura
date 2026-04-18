import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, ioMock, socketInstances, runtimeApiConfig } = vi.hoisted(() => {
    const sharedSocketInstances = [];
    const sharedAuthState = {
        currentUser: { uid: 'socket-user-1' },
        loading: false,
    };
    const sharedRuntimeApiConfig = {
        resolveServiceOrigin: vi.fn(() => 'https://api.example.test'),
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
        runtimeApiConfig: sharedRuntimeApiConfig,
    };
});

authState.loading = false;
authState.currentUser = { uid: 'socket-user-1' };

vi.mock('socket.io-client', () => ({
    io: ioMock,
}));

vi.mock('../services/runtimeApiConfig', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolveServiceOrigin: runtimeApiConfig.resolveServiceOrigin,
    };
});

vi.stubEnv('VITE_ENABLE_REALTIME_SOCKET', 'true');

const { SocketProvider, useSocketDemand } = await import('./SocketContext');
const { AuthContext } = await import('./AuthContext');

const DemandProbe = ({ extraDemand = false }) => {
    useSocketDemand('video-calls-global', true);
    useSocketDemand('support-screen', extraDemand);
    return null;
};

describe('SocketProvider', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        ioMock.mockClear();
        socketInstances.length = 0;
        authState.loading = false;
        authState.currentUser = { uid: 'socket-user-1' };
        runtimeApiConfig.resolveServiceOrigin.mockReset();
        runtimeApiConfig.resolveServiceOrigin.mockReturnValue('https://api.example.test');
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalLocation,
        });
    });

    it('keeps the same socket connection while realtime demand keys change', async () => {
        const view = render(
            <AuthContext.Provider value={authState}>
                <SocketProvider>
                    <DemandProbe extraDemand={false} />
                </SocketProvider>
            </AuthContext.Provider>
        );

        await waitFor(() => {
            expect(ioMock).toHaveBeenCalledTimes(1);
        });

        const firstSocket = socketInstances[0]?.socket;
        expect(firstSocket).toBeTruthy();

        view.rerender(
            <AuthContext.Provider value={authState}>
                <SocketProvider>
                    <DemandProbe extraDemand />
                </SocketProvider>
            </AuthContext.Provider>
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(ioMock).toHaveBeenCalledTimes(1);
        expect(firstSocket.disconnect).not.toHaveBeenCalled();

        view.rerender(
            <AuthContext.Provider value={authState}>
                <SocketProvider>
                    <DemandProbe extraDemand={false} />
                </SocketProvider>
            </AuthContext.Provider>
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(ioMock).toHaveBeenCalledTimes(1);
        expect(firstSocket.disconnect).not.toHaveBeenCalled();
    });

    it('maintains a socket for authenticated users even without explicit demand hooks', async () => {
        render(
            <AuthContext.Provider value={authState}>
                <SocketProvider>
                    <div>child</div>
                </SocketProvider>
            </AuthContext.Provider>
        );

        await waitFor(() => {
            expect(ioMock).toHaveBeenCalledTimes(1);
        });

        expect(socketInstances[0]?.options?.withCredentials).toBe(true);
        expect(socketInstances[0]?.options?.auth ?? null).toBeNull();
        expect(socketInstances[0]?.socket.connect).toHaveBeenCalledTimes(1);
    });

    it('forces polling when a hosted Vercel frontend proxies realtime through its own origin', async () => {
        runtimeApiConfig.resolveServiceOrigin.mockReturnValue('https://aurapilot.vercel.app');
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                origin: 'https://aurapilot.vercel.app',
                host: 'aurapilot.vercel.app',
                hostname: 'aurapilot.vercel.app',
            },
        });

        render(
            <AuthContext.Provider value={authState}>
                <SocketProvider>
                    <div>child</div>
                </SocketProvider>
            </AuthContext.Provider>
        );

        await waitFor(() => {
            expect(ioMock).toHaveBeenCalledTimes(1);
        });

        expect(socketInstances[0]?.options?.transports).toEqual(['polling']);
        expect(socketInstances[0]?.options?.upgrade).toBe(false);
        expect(socketInstances[0]?.options?.rememberUpgrade).toBe(false);
    });
});
