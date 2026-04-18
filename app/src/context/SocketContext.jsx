import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { resolveServiceOrigin } from '../services/runtimeApiConfig';

const SocketContext = createContext(null);
const SOCKET_RUNTIME_FLAG = String(import.meta.env.VITE_ENABLE_REALTIME_SOCKET || '').trim().toLowerCase();
const SOCKET_RUNTIME_ENABLED = SOCKET_RUNTIME_FLAG === '' ? true : SOCKET_RUNTIME_FLAG === 'true';
const SOCKET_RECONNECT_GRACE_MS = 20000;
const SOCKET_CONNECT_TIMEOUT_MS = 20000;
const SOCKET_RECONNECTION_DELAY_MS = 1000;
const SOCKET_RECONNECTION_DELAY_MAX_MS = 15000;
const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');
const isSocketAuthError = (error) => String(error?.message || '').toLowerCase().includes('authentication error');

const shouldUseHostedProxyPolling = (socketOrigin = '') => {
    if (typeof window === 'undefined') return false;

    const runtimeOrigin = trimTrailingSlash(window.location?.origin || '');
    const runtimeHost = String(window.location?.hostname || '').trim().toLowerCase();
    const normalizedSocketOrigin = trimTrailingSlash(socketOrigin);

    return Boolean(runtimeOrigin)
        && runtimeHost.endsWith('.vercel.app')
        && normalizedSocketOrigin === runtimeOrigin;
};

export const useSocket = () => useContext(SocketContext);
export const useSocketDemand = (key, enabled = true) => {
    const context = useSocket();
    const activateSocketDemand = context?.activateSocketDemand;
    const deactivateSocketDemand = context?.deactivateSocketDemand;

    useEffect(() => {
        if (!enabled || !key || !activateSocketDemand || !deactivateSocketDemand) {
            return undefined;
        }

        activateSocketDemand(key);
        return () => deactivateSocketDemand(key);
    }, [activateSocketDemand, deactivateSocketDemand, enabled, key]);

    return context;
};

export const SocketProvider = ({ children }) => {
    const { currentUser, loading } = useAuth();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionState, setConnectionState] = useState('idle');
    const [socketDemandKeys, setSocketDemandKeys] = useState([]);
    const hasRealtimeDemand = socketDemandKeys.length > 0;
    const reconnectGraceTimerRef = useRef(null);
    const activeSocketRef = useRef(null);
    const hasConnectedOnceRef = useRef(false);

    const activateSocketDemand = useCallback((key) => {
        setSocketDemandKeys((previous) => (
            previous.includes(key) ? previous : [...previous, key]
        ));
    }, []);

    const deactivateSocketDemand = useCallback((key) => {
        setSocketDemandKeys((previous) => previous.filter((entry) => entry !== key));
    }, []);

    const clearReconnectGraceTimer = useCallback(() => {
        if (reconnectGraceTimerRef.current) {
            window.clearTimeout(reconnectGraceTimerRef.current);
            reconnectGraceTimerRef.current = null;
        }
    }, []);

    const enterReconnectGrace = useCallback(() => {
        clearReconnectGraceTimer();

        if (!hasConnectedOnceRef.current) {
            setIsConnected(false);
            setConnectionState('connecting');
            return;
        }

        setIsConnected(true);
        setConnectionState('reconnecting');
        reconnectGraceTimerRef.current = window.setTimeout(() => {
            if (!activeSocketRef.current?.connected) {
                setIsConnected(false);
                setConnectionState('disconnected');
            }
        }, SOCKET_RECONNECT_GRACE_MS);
    }, [clearReconnectGraceTimer]);

    const resetConnection = useCallback((nextState = 'idle') => {
        clearReconnectGraceTimer();
        activeSocketRef.current = null;
        hasConnectedOnceRef.current = false;
        setSocket(null);
        setIsConnected(false);
        setConnectionState(nextState);
    }, [clearReconnectGraceTimer]);

    useEffect(() => {
        let isActive = true;
        let activeSocket = null;
        let handleConnect = () => {};
        let handleDisconnect = () => {};
        let handleConnectError = () => {};
        let handleReconnectAttempt = () => {};
        let handleReconnect = () => {};
        let handleReconnectError = () => {};
        let handleReconnectFailed = () => {};
        let handleOnline = () => {};
        let handleVisibilityChange = () => {};

        const shouldMaintainSocket = SOCKET_RUNTIME_ENABLED && !loading && Boolean(currentUser);
        if (!shouldMaintainSocket) {
            resetConnection('idle');
            return () => {
                isActive = false;
            };
        }

        const resolveSocketAuthPayload = async (forceRefresh = false) => {
            if (!currentUser || typeof currentUser.getIdToken !== 'function') {
                return {};
            }

            const token = String(await currentUser.getIdToken(forceRefresh) || '').trim();
            return token ? { token } : {};
        };

        const syncSocketAuth = async (forceRefresh = false) => {
            const authPayload = await resolveSocketAuthPayload(forceRefresh);
            if (activeSocket) {
                activeSocket.auth = authPayload;
                if (activeSocket.io?.opts) {
                    activeSocket.io.opts.auth = authPayload;
                }
            }
            return authPayload;
        };

        let hasRetriedAuthBootstrap = false;

        const reconnectSocket = async (forceRefresh = false) => {
            if (!activeSocket || activeSocket.connected) {
                return;
            }

            try {
                await syncSocketAuth(forceRefresh);
                activeSocket.connect();
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('Socket reconnect bootstrap failed:', error);
                }
            }
        };

        const connectSocket = async () => {
            try {
                if (!isActive) {
                    resetConnection('disconnected');
                    return;
                }

                const socketOrigin = resolveServiceOrigin('');

                const useHostedProxyPolling = shouldUseHostedProxyPolling(socketOrigin);
                const authPayload = await resolveSocketAuthPayload();

                activeSocket = io(socketOrigin, {
                    autoConnect: false,
                    auth: authPayload,
                    reconnection: true,
                    reconnectionAttempts: Number.POSITIVE_INFINITY,
                    reconnectionDelay: SOCKET_RECONNECTION_DELAY_MS,
                    reconnectionDelayMax: SOCKET_RECONNECTION_DELAY_MAX_MS,
                    randomizationFactor: 0.5,
                    timeout: SOCKET_CONNECT_TIMEOUT_MS,
                    transports: useHostedProxyPolling ? ['polling'] : ['websocket', 'polling'],
                    upgrade: !useHostedProxyPolling,
                    rememberUpgrade: !useHostedProxyPolling,
                    withCredentials: true,
                });

                activeSocketRef.current = activeSocket;
                setSocket(activeSocket);
                setConnectionState(hasConnectedOnceRef.current ? 'reconnecting' : 'connecting');

                handleConnect = () => {
                    if (!isActive) return;
                    hasRetriedAuthBootstrap = false;
                    hasConnectedOnceRef.current = true;
                    clearReconnectGraceTimer();
                    setIsConnected(true);
                    setConnectionState('connected');
                };

                handleDisconnect = (reason) => {
                    if (!isActive) return;
                    if (reason === 'io client disconnect') {
                        clearReconnectGraceTimer();
                        setIsConnected(false);
                        setConnectionState('disconnected');
                        return;
                    }
                    enterReconnectGrace();
                };

                handleConnectError = (error) => {
                    if (import.meta.env.DEV) {
                        console.error('Socket connection error:', error);
                    }
                    if (!isActive) return;

                    if (isSocketAuthError(error) && !hasRetriedAuthBootstrap) {
                        hasRetriedAuthBootstrap = true;
                        void reconnectSocket(true);
                        return;
                    }

                    if (!hasConnectedOnceRef.current) {
                        setIsConnected(false);
                        setConnectionState('disconnected');
                        return;
                    }

                    enterReconnectGrace();
                };

                handleReconnectAttempt = () => {
                    if (!isActive) return;
                    void syncSocketAuth();
                    enterReconnectGrace();
                };

                handleReconnect = () => {
                    if (!isActive) return;
                    hasConnectedOnceRef.current = true;
                    clearReconnectGraceTimer();
                    setIsConnected(true);
                    setConnectionState('connected');
                };

                handleReconnectError = () => {
                    if (!isActive) return;
                    enterReconnectGrace();
                };

                handleReconnectFailed = () => {
                    if (!isActive) return;
                    clearReconnectGraceTimer();
                    setIsConnected(false);
                    setConnectionState('disconnected');
                };

                handleOnline = () => {
                    void reconnectSocket(true);
                };

                handleVisibilityChange = () => {
                    if (document.visibilityState === 'visible') {
                        void reconnectSocket();
                    }
                };

                activeSocket.on('connect', handleConnect);
                activeSocket.on('disconnect', handleDisconnect);
                activeSocket.on('connect_error', handleConnectError);
                activeSocket.io?.on?.('reconnect_attempt', handleReconnectAttempt);
                activeSocket.io?.on?.('reconnect', handleReconnect);
                activeSocket.io?.on?.('reconnect_error', handleReconnectError);
                activeSocket.io?.on?.('reconnect_failed', handleReconnectFailed);
                window.addEventListener('online', handleOnline);
                document.addEventListener('visibilitychange', handleVisibilityChange);

                activeSocket.connect();

                if (!isActive) {
                    activeSocket.disconnect();
                }
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('Socket token bootstrap failed:', error);
                }
                resetConnection('disconnected');
            }
        };

        connectSocket();

        return () => {
            isActive = false;
            clearReconnectGraceTimer();
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);

            if (activeSocket) {
                activeSocket.off('connect', handleConnect);
                activeSocket.off('disconnect', handleDisconnect);
                activeSocket.off('connect_error', handleConnectError);
                activeSocket.io?.off?.('reconnect_attempt', handleReconnectAttempt);
                activeSocket.io?.off?.('reconnect', handleReconnect);
                activeSocket.io?.off?.('reconnect_error', handleReconnectError);
                activeSocket.io?.off?.('reconnect_failed', handleReconnectFailed);
                activeSocket.disconnect();
            }

            resetConnection('idle');
        };
    }, [clearReconnectGraceTimer, currentUser, enterReconnectGrace, loading, resetConnection]);

    const contextValue = useMemo(() => ({
            socket,
            isConnected,
            connectionState,
            hasRealtimeDemand,
            activateSocketDemand,
            deactivateSocketDemand,
        }), [socket, isConnected, connectionState, hasRealtimeDemand, activateSocketDemand, deactivateSocketDemand]);

    return (
        <SocketContext.Provider value={contextValue}>
            {children}
        </SocketContext.Provider>
    );
};
