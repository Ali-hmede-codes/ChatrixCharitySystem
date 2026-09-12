import { EventEmitter } from "node:events";
import { createChannelRegistry } from "../kernel/channels.js";

export function createContext({ config, logger, app, httpServer, io }) {
  const services = Object.create(null);
  const socketBinders = [];
  const listeningHooks = [];
  const events = new EventEmitter();
  events.setMaxListeners(50);

  const ctx = {
    config,
    logger,
    app,
    httpServer,
    io,
    events,
    services,
    channels: createChannelRegistry(),
    httpPort: config.PORT,
    onSocket(binder) {
      socketBinders.push(binder);
    },
    bindSocket(socket) {
      for (const binder of socketBinders) binder(socket);
    },
    onListening(hook) {
      listeningHooks.push(hook);
    },
    async emitListening() {
      for (const hook of listeningHooks) await hook(ctx);
    },
    broadcast() {
      const status = services.whatsapp?.getStatus?.() || {
        state: "starting",
        phone: null,
        message: "Starting WhatsApp connection…",
      };
      const sendStatus = services.send?.getStatus?.() || {};
      io.emit("wa:status", {
        ...status,
        qr: services.whatsapp?.getQr?.() ?? null,
        sending: services.send?.isRunning?.() ?? false,
        paused: Boolean(sendStatus.paused),
        pauseReason: sendStatus.pauseReason || null,
        campaignId: sendStatus.campaignId || null,
        remaining: sendStatus.remaining || 0,
        port: ctx.httpPort,
      });
    },
  };

  return ctx;
}
