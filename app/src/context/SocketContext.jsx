import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { resolveServiceOrigin } from '../services/runtimeApiConfig';

const SocketContext = createContext(null);

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const { currentUser, loading } = useAuth();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        let isActive = true;
        let activeSocket = null;

        const resetConnection = () => {
            if (!isActive) return;
            setSocket(null);
            setIsConnected(false);
        };

        if (loading || !currentUser) {
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
    }, [currentUser, loading]);

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
        </SocketContext.Provider>
    );
};
