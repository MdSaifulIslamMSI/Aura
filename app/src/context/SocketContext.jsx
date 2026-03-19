import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { resolveServiceOrigin } from '../services/runtimeApiConfig';

const SocketContext = createContext(null);
const SOCKET_RUNTIME_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_REALTIME_SOCKET === 'true';

export const useSocket = () => useContext(SocketContext);
export const useSocketDemand = (key, enabled = true) => {
    const context = useSocket();

    useEffect(() => {
        if (!enabled || !key || !context?.activateSocketDemand || !context?.deactivateSocketDemand) {
            return undefined;
        }

        context.activateSocketDemand(key);
        return () => context.deactivateSocketDemand(key);
    }, [context, enabled, key]);

    return context;
};

export const SocketProvider = ({ children }) => {
    const { currentUser, loading } = useAuth();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [socketDemandKeys, setSocketDemandKeys] = useState([]);

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
        const hasRealtimeDemand = socketDemandKeys.length > 0;

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
    }, [currentUser, loading, socketDemandKeys]);

    return (
        <SocketContext.Provider value={{
            socket,
            isConnected,
            hasRealtimeDemand: socketDemandKeys.length > 0,
            activateSocketDemand,
            deactivateSocketDemand,
        }}>
            {children}
        </SocketContext.Provider>
    );
};
