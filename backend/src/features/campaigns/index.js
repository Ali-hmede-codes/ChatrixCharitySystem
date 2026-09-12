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

      socket.on("campaigns:update", (payload) => {
        const result = campaigns.update(payload?.id, payload || {});
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:saved", result);
      });

      socket.on("campaigns:remove-recipients", (payload) => {
        const result = campaigns.removeRecipients(payload?.id || payload?.campaignId, payload?.phones);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:saved", result);
      });

      socket.on("campaigns:delete", async (payload) => {
        const result = await campaigns.delete(payload?.id);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:deleted", result);
      });

      socket.on("campaigns:delete-many", async (payload) => {
        const result = await campaigns.deleteMany(payload?.ids);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:deleted", result);
      });

      socket.on("campaigns:merge", (payload) => {
        const result = campaigns.merge(payload?.ids, { name: payload?.name });
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:merged", result);
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
