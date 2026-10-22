import type { ClientMessage, ServerMessage } from './protocol';

type Listener = (message: ServerMessage) => void;
type CloseListener = (event: CloseEvent) => void;

/**
 * Thin typed wrapper around a WebSocket to the signaling server.
 * Signaling is just a mailbox: it carries SDP and ICE candidates until the
 * peers can talk directly. Media never touches this connection.
 */
export class SignalingClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly closeListeners = new Set<CloseListener>();

  constructor(private readonly url: string) {}

  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      const timer = window.setTimeout(() => {
        socket.close();
        reject(new Error(`Could not reach signaling server at ${this.url}`));
      }, timeoutMs);

      socket.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error(`Could not reach signaling server at ${this.url}`));
      };
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          console.warn('[signaling] ignoring non-JSON message', event.data);
          return;
        }
        for (const listener of this.listeners) listener(message);
      };
      socket.onclose = (event) => {
        for (const listener of this.closeListeners) listener(event);
      };
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.warn('[signaling] dropped message, socket not open:', message.type);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    this.closeListeners.clear();
    this.socket?.close();
    this.socket = null;
  }
}
