import { createCampaignService } from "./service.js";

export const campaignsFeature = {
  name: "campaigns",
  init(ctx) {
    ctx.services.campaigns = createCampaignService(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const campaigns = ctx.services.campaigns;
      campaigns.emit(socket);

      socket.on("campaigns:list", () => {
        campaigns.emit(socket);
      });

      socket.on("campaigns:get", (payload) => {
        const id = payload?.id;
        const details = campaigns.get(id);
        socket.emit("campaigns:details", details);
      });

      socket.on("campaigns:delete", async (payload) => {
        const id = payload?.id;
        if (id) {
          await campaigns.delete(id);
        }
      });

      socket.on("pickup:search", (payload) => {
        socket.emit("pickup:results", campaigns.searchPickup(payload || {}));
      });

      socket.on("pickup:export", (payload) => {
        const result = campaigns.searchPickup({
          ...(payload || {}),
          status: "taken",
          limit: 5000,
        });
        socket.emit("pickup:export-data", result);
      });

      socket.on("pickup:mark", (payload) => {
        const result = campaigns.markTaken(payload?.campaignId, payload?.phone, payload?.personName);
        socket.emit("pickup:done", result);
      });

      socket.on("pickup:reprint", (payload) => {
        const result = campaigns.reprintTaken(payload?.campaignId, payload?.phone, payload?.personName);
        socket.emit("pickup:done", result);
      });

      socket.on("pickup:undo", (payload) => {
        const result = campaigns.undoTaken(payload?.campaignId, payload?.phone, payload?.personName);
        socket.emit("pickup:done", result);
      });
    });
  },
};
