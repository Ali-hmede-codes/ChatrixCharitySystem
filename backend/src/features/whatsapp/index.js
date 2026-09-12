import { createWhatsAppService } from "./service.js";

export const whatsappFeature = {
  name: "whatsapp",
  init(ctx) {
    const whatsapp = createWhatsAppService(ctx);
    ctx.services.whatsapp = whatsapp;
    ctx.channels.register({
      id: "whatsapp",
      kind: "primary",
      label: "WhatsApp",
      ready: () => whatsapp.isOpen(),
    });
    ctx.onListening(() => whatsapp.start());
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      ctx.broadcast();
      socket.on("wa:logout", async () => {
        try {
          await ctx.services.whatsapp.logout();
        } catch (error) {
          socket.emit("wa:reset:error", error.message || "Could not disconnect WhatsApp.");
        }
      });
      socket.on("wa:reset", async () => {
        try {
          await ctx.services.whatsapp.resetSession();
        } catch (error) {
          socket.emit("wa:reset:error", error.message || "Could not clear the WhatsApp session.");
        }
      });
    });
  },
};
