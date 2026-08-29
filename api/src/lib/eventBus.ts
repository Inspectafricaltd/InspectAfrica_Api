/**
 * In-memory SSE event bus.
 * Works for single-container deployments (Railway). If horizontal scaling
 * is needed later, replace the Map with a Redis pub/sub adapter.
 */

interface SseConnection {
  userId: string;
  role: string;
  write: (event: string, data: Record<string, unknown>) => void;
  close: () => void;
}

// One active SSE stream per user (new connection replaces old)
const connections = new Map<string, SseConnection>();

export function register(conn: SseConnection): void {
  // Close existing connection for this user before replacing
  connections.get(conn.userId)?.close();
  connections.set(conn.userId, conn);
}

export function deregister(userId: string): void {
  connections.delete(userId);
}

/** Push an event to a specific user. */
export function broadcast(userId: string, type: string, data: Record<string, unknown> = {}): void {
  connections.get(userId)?.write(type, data);
}

/** Push an event to every connected user with the given role. */
export function broadcastToRole(role: string, type: string, data: Record<string, unknown> = {}): void {
  for (const conn of connections.values()) {
    if (conn.role === role) conn.write(type, data);
  }
}

export function connectionCount(): number {
  return connections.size;
}
