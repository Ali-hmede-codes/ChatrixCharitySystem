import { createSignDeviceService } from "./service.js";

export const signDevicesFeature = {
  name: "sign-devices",
  init(ctx) {
    ctx.services.signDevices = createSignDeviceService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const signDevices = ctx.services.signDevices;
      socket.on("sign-device:hello", (payload) => signDevices.hello(socket, payload));
      socket.on("sign-device:rename", (payload) => signDevices.rename(socket, payload));
      socket.on("pickup:sign-request", (payload) => signDevices.request(socket, payload));
      socket.on("pickup:sign-submit", (payload) => signDevices.submit(socket, payload));
      socket.on("pickup:sign-cancel", (payload) => signDevices.cancel(socket, payload));
      socket.on("disconnect", () => signDevices.onDisconnect(socket));
    });
  },
};
