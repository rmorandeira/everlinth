import type { ClientMessage, ServerMessage } from "@roi/shared";

export class GameConnection {
  private socket: WebSocket;

  constructor(onMessage: (msg: ServerMessage) => void, onClose: () => void) {
    const isDev = import.meta.env.DEV;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const host = isDev ? `${location.hostname}:3000` : location.host;
    this.socket = new WebSocket(`${protocol}://${host}`);
    this.socket.addEventListener("message", (ev) => {
      onMessage(JSON.parse(ev.data));
    });
    this.socket.addEventListener("close", onClose);
  }

  waitOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => this.socket.addEventListener("open", () => resolve(), { once: true }));
  }

  send(msg: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  close(): void {
    this.socket.close();
  }
}
