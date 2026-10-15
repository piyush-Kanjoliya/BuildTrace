import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';
import { getToken } from '../lib/api.js';

const SocketContext = createContext({ socket: null, connected: false, subscribe: () => {} });

/**
 * One authenticated Socket.IO connection for the whole app.
 *
 * Server payloads are notification-only (ids + summaries); components react by
 * refetching authoritative state from the REST API. Reconnect is automatic.
 */
export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      setConnected(false);
      return undefined;
    }
    const instance = io(
  import.meta.env.VITE_SOCKET_URL || undefined,
  {
    path: '/socket.io',
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
  }
);
    instance.on('connect', () => setConnected(true));
    instance.on('disconnect', () => setConnected(false));
    instance.on('connect_error', () => setConnected(false));
    setSocket(instance);
    return () => {
      instance.close();
      setSocket(null);
      setConnected(false);
    };
  }, [user]);

  const subscribe = useMemo(
    () => (projectId) => {
      if (socket && projectId) socket.emit('project:subscribe', String(projectId));
    },
    [socket]
  );

  const value = useMemo(() => ({ socket, connected, subscribe }), [socket, connected, subscribe]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}

/**
 * Subscribe to a project room and wire up realtime handlers for the lifetime
 * of a component. Every handler is a refetch trigger - MongoDB stays the
 * source of truth.
 */
export function useProjectRoom(projectId, handlers = {}) {
  const { socket, subscribe } = useSocket();

  useEffect(() => {
    if (!socket || !projectId) return undefined;
    subscribe(projectId);
    const pairs = Object.entries(handlers).filter(([, fn]) => typeof fn === 'function');
    pairs.forEach(([event, fn]) => socket.on(event, fn));
    return () => pairs.forEach(([event, fn]) => socket.off(event, fn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, projectId, subscribe, ...Object.values(handlers)]);
}
