import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { resolveServiceOrigin } from '../services/runtimeApiConfig';

const SocketContext = createContext(null);
const SOCKET_RUNTIME_FLAG = String(import.meta.env.VITE_ENABLE_REALTIME_SOCKET || '').trim().toLowerCase();
const SOCKET_RUNTIME_ENABLED = SOCKET_RUNTIME_FLAG === '' ? true : SOCKET_RUNTIME_FLAG === 'true';

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
    const [socketDemandKeys, setSocketDemandKeys] = useState([]);
    const hasRealtimeDemand = socketDemandKeys.length > 0;

    const activateSocketDemand = useCallback((key) => {
        setSocketDemandKeys((previous) => (
            previous.includes(key) ? previous : [...previous, key]
        ));
    }, []);

    const deactivateSocketDemand = useCallback((key) => {
        setSocketDemandKeys((previous) => previous.filter((entry) => entry !== key));
    }, []);

    useEffect(() => {
        let isActive = true;
        let activeSocket = null;

        const resetConnection = () => {
            if (!isActive) return;
            setSocket(null);
            setIsConnected(false);
        };

        if (!SOCKET_RUNTIME_ENABLED || !hasRealtimeDemand || loading || !currentUser) {
            resetConnection();
            return () => {
                isActive = false;
            };
        }

        const connectSocket = async () => {
            try {
                const token = await currentUser.getIdToken();
                if (!isActive || !token) {
                    resetConnection();
                    return;
                }

                const socketOrigin = resolveServiceOrigin('');

                activeSocket = io(socketOrigin, {
                    auth: { token },
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                });

                activeSocket.on('connect', () => {
                    if (!isActive) return;
                    setIsConnected(true);
                });

                activeSocket.on('disconnect', () => {
                    if (!isActive) return;
                    setIsConnected(false);
                });

                activeSocket.on('connect_error', (error) => {
                    if (import.meta.env.DEV) {
                        console.error('Socket connection error:', error);
                    }
                    if (!isActive) return;
                    setIsConnected(false);
                });

                if (!isActive) {
                    activeSocket.disconnect();
                    return;
                }

                setSocket(activeSocket);
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('Socket token bootstrap failed:', error);
                }
                resetConnection();
            }
        };

        connectSocket();

        return () => {
            isActive = false;
            if (activeSocket) {
                activeSocket.disconnect();
            }
        };
    }, [currentUser, hasRealtimeDemand, loading]);

    const contextValue = useMemo(() => ({
            socket,
            isConnected,
            hasRealtimeDemand,
            activateSocketDemand,
            deactivateSocketDemand,
        }), [socket, isConnected, hasRealtimeDemand, activateSocketDemand, deactivateSocketDemand]);

    return (
        <SocketContext.Provider value={contextValue}>
            {children}
        </SocketContext.Provider>
    );
};
