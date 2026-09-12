import { createSmsService } from "./service.js";

export const smsFeature = {
  name: "sms",
  init(ctx) {
    const sms = createSmsService(ctx);
    ctx.services.sms = sms;
    ctx.channels.register({
      id: "sms",
      kind: "fallback",
      label: "SMS",
      ready: () => sms.ready(),
      send: ({ phone, text, shouldSkip }) =>
        sms.enqueue(() => sms.send({ phone, text }), shouldSkip),
    });
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const sms = ctx.services.sms;
      sms.emit(socket);
      socket.on("sms:get", () => sms.emit(socket));
      socket.on("sms:save", async (payload) => sms.save(payload || {}, socket));
    });
  },
};
