import { createContactsService } from "./service.js";

export const contactsFeature = {
  name: "contacts",
  init(ctx) {
    ctx.services.contacts = createContactsService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const contacts = ctx.services.contacts;
      contacts.emitList(socket);
      socket.on("contacts:list", () => contacts.emitList(socket));
      socket.on("contacts:save", async (payload) => contacts.saveBatch(payload || {}, socket));
      socket.on("contacts:check", async (payload) => contacts.check(payload || {}, socket));
    });
  },
};
