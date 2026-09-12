import { createSendService } from "./job.js";

export const sendFeature = {
  name: "send",
  init(ctx) {
    ctx.services.send = createSendService(ctx);
    ctx.events.on("whatsapp:open", () => {
      try {
        ctx.services.send.onWhatsAppOpen();
      } catch (error) {
        ctx.logger.warn({ err: error }, "send resume on WhatsApp open failed");
      }
    });
    ctx.events.on("whatsapp:closed", (info) => {
      try {
        ctx.services.send.onWhatsAppClosed(info || {});
      } catch (error) {
        ctx.logger.warn({ err: error }, "send pause on WhatsApp close failed");
      }
    });
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      ctx.services.send.sync(socket);
      socket.on("send:stop", () => ctx.services.send.stop());
      socket.on("send:start", async (payload) => ctx.services.send.start(payload || {}, socket));
      socket.on("send:resume", async (payload) => ctx.services.send.resume(payload || {}, socket));
      socket.on("send:sync", () => ctx.services.send.sync(socket));
    });
  },
};
