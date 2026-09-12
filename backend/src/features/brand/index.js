import { createBrandService } from "./service.js";

export const brandFeature = {
  name: "brand",
  init(ctx) {
    const brand = createBrandService(ctx);
    ctx.services.brand = brand;
  },
  http(ctx) {
    ctx.app.get("/logo", (req, res) => ctx.services.brand.serveLogo(req, res));
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const brand = ctx.services.brand;
      brand.emitBrand(socket);
      socket.on("logo:get", () => brand.emitBrand(socket));
      socket.on("logo:save", async (payload) => brand.saveLogo(payload || {}, socket));
      socket.on("logo:clear", async () => brand.clearLogo(socket));
    });
  },
};
