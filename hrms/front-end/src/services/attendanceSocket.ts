import { io, Socket } from "socket.io-client";
import { getToken } from "@/utils/auth";

export type AttendanceUpdatePayload = {
  event?: "CHECK_IN" | "CHECK_OUT" | "REQUEST_APPROVED";
  attendance?: unknown;
};

type AttendanceHandler = (payload: AttendanceUpdatePayload) => void;

export type RealtimeNotification = {
  _id: string;
  type?: string;
  title: string;
  message: string;
  isRead?: boolean;
  createdAt: string;
  meta?: Record<string, unknown>;
};

type NotificationHandler = (payload: RealtimeNotification) => void;

let socketInstance: Socket | null = null;
let connectedToken: string | null = null;

const resolveSocketUrl = () => {
  const configuredUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || window.location.origin;
  try {
    return new URL(configuredUrl, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
};

export const getAttendanceSocket = () => {
  const token = getToken();
  if (!token) return null;

  if (!socketInstance) {
    connectedToken = token;
    socketInstance = io(resolveSocketUrl(), {
      path: import.meta.env.VITE_SOCKET_PATH || "/api/socket.io",
      // Establish through the existing HTTPS API proxy first. Socket.IO can
      // upgrade afterward when the production proxy supports WebSocket upgrade.
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: { token }
    });
  } else if (connectedToken !== token) {
    connectedToken = token;
    socketInstance.auth = { token };
    socketInstance.disconnect().connect();
  }

  return socketInstance;
};

export const reconnectRealtimeSocket = () => getAttendanceSocket();

export const disconnectRealtimeSocket = () => {
  socketInstance?.disconnect();
  socketInstance = null;
  connectedToken = null;
};

export const subscribeAttendanceUpdates = (handler: AttendanceHandler) => {
  const socket = getAttendanceSocket();
  if (!socket) return () => undefined;

  const eventName = "attendance:updated";
  socket.on(eventName, handler);

  return () => {
    socket.off(eventName, handler);
  };
};

export const subscribeNotifications = (handler: NotificationHandler) => {
  const socket = getAttendanceSocket();
  if (!socket) return () => undefined;

  const eventName = "notification:new";
  socket.on(eventName, handler);

  return () => {
    socket.off(eventName, handler);
  };
};
