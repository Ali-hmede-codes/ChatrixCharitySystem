import { createInventoryService } from "./service.js";

export const inventoryFeature = {
  name: "inventory",
  init(ctx) {
    ctx.services.inventory = createInventoryService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const inventory = ctx.services.inventory;
      inventory.emit(socket);
      socket.on("inventory:get", () => inventory.emit(socket));
      socket.on("inventory:set", async (payload) => {
        const next = await inventory.set(payload || {});
        socket.emit("inventory:saved", next);
      });
    });
  },
};
