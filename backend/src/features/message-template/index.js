import { createMessageTemplateService } from "./service.js";

export const messageTemplateFeature = {
  name: "message-template",
  init(ctx) {
    ctx.services.messages = createMessageTemplateService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const messages = ctx.services.messages;
      messages.emit(socket);
      socket.on("message:get", () => messages.emit(socket));
      socket.on("message:save", async (payload) => messages.save(payload || {}, socket));
    });
  },
};
