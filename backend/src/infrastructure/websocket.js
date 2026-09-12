import { WebSocket } from "ws";

if (typeof globalThis.WebSocket !== "function") {
  globalThis.WebSocket = WebSocket;
}
