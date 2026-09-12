import { createPrinterService } from "./service.js";

export const printerFeature = {
  name: "printer",
  init(ctx) {
    ctx.services.printer = createPrinterService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const printer = ctx.services.printer;
      printer.emit(socket);
      socket.on("printer:get", () => printer.emit(socket));
      socket.on("printer:save", async (payload) => printer.save(payload || {}, socket));
    });
  },
};
