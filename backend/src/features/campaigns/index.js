import { createJsonStore } from "../../infrastructure/json-file.js";
import { createCampaignService } from "./service.js";

function createSignatureMode(ctx) {
  const store = createJsonStore(ctx.config.PICKUP_SETTINGS_PATH, { requireSignature: true });
  let requireSignature = true;

  function load() {
    const raw = store.read();
    requireSignature = raw?.requireSignature !== false;
  }

  function payload() {
    return { requireSignature };
  }

  function emit(socket) {
    const data = payload();
    if (socket) socket.emit("pickup:signature-mode", data);
    else ctx.io.emit("pickup:signature-mode", data);
  }

  let queue = Promise.resolve();

  function set(enabled) {
    const run = queue.then(async () => {
      const next = enabled !== false;
      const previous = requireSignature;
      requireSignature = next;
      try {
        await store.write({ requireSignature: next });
      } catch (err) {
        requireSignature = previous;
        ctx.logger?.error?.({ err }, "signature mode save failed");
        return { ok: false, ...payload() };
      }
      emit();
      return { ok: true, ...payload() };
    });
    queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  load();
  return { payload, emit, set };
}

export const campaignsFeature = {
  name: "campaigns",
  init(ctx) {
    ctx.services.campaigns = createCampaignService(ctx);
    ctx.services.signatureMode = createSignatureMode(ctx);
  },
  sockets(ctx) {
    ctx.onSocket((socket) => {
      const campaigns = ctx.services.campaigns;
      const signatureMode = ctx.services.signatureMode;
      campaigns.emit(socket);
      signatureMode.emit(socket);

      socket.on("pickup:signature-mode:get", () => {
        signatureMode.emit(socket);
      });

      socket.on("pickup:signature-mode:set", async (payload) => {
        const result = await signatureMode.set(payload?.requireSignature);
        if (!result.ok) {
          socket.emit("pickup:signature-mode", { requireSignature: result.requireSignature });
          socket.emit("pickup:signature-mode:error", "Could not update the signature switch for everyone.");
        }
      });

      socket.on("campaigns:list", () => {
        campaigns.emit(socket);
      });

      socket.on("campaigns:get", (payload) => {
        const id = payload?.id;
        const details = campaigns.get(id);
        socket.emit("campaigns:details", details);
      });

      socket.on("campaigns:update", async (payload) => {
        const result = await campaigns.update(payload?.id, payload || {});
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:saved", result);
      });

      socket.on("campaigns:remove-recipients", async (payload) => {
        const result = await campaigns.removeRecipients(payload?.id || payload?.campaignId, payload?.phones);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:saved", result);
      });

      socket.on("campaigns:delete", async (payload) => {
        const id = payload?.id;
        // Capture recallable sent-message data BEFORE the campaign is removed,
        // then fire a background recall job to unsend those WhatsApp messages
        // (only those sent within the recall window). Non-blocking.
        const recallable = campaigns.collectRecallable([id]);
        const result = await campaigns.delete(id);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else {
          for (const group of recallable) {
            ctx.services.send?.recallMessages?.(group.items, group.name);
          }
          socket.emit("campaigns:deleted", result);
        }
      });

      socket.on("campaigns:delete-many", async (payload) => {
        const ids = payload?.ids;
        const recallable = campaigns.collectRecallable(ids);
        const result = await campaigns.deleteMany(ids);
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else {
          for (const group of recallable) {
            ctx.services.send?.recallMessages?.(group.items, group.name);
          }
          socket.emit("campaigns:deleted", result);
        }
      });

      socket.on("campaigns:merge", async (payload) => {
        const result = await campaigns.merge(payload?.ids, { name: payload?.name });
        if (!result.ok) socket.emit("campaigns:error", result.error);
        else socket.emit("campaigns:merged", result);
      });

      socket.on("pickup:search", (payload) => {
        socket.emit("pickup:results", campaigns.searchPickup(payload || {}));
      });

      socket.on("pickup:import", async (payload) => {
        try {
          const result = await campaigns.importPickupList(payload || {});
          if (!result.ok) socket.emit("pickup:import:error", result.error);
          else socket.emit("pickup:import:done", result);
        } catch (err) {
          ctx.logger?.error?.({ err }, "pickup import failed");
          socket.emit("pickup:import:error", "Could not import that spreadsheet.");
        }
      });

      socket.on("pickup:signatures", (payload) => {
        const codes = Array.isArray(payload?.codes) ? payload.codes : [];
        socket.emit("pickup:signatures:result", {
          requestId: payload?.requestId || "",
          ...campaigns.signaturesForCodes(codes),
        });
      });

      socket.on("pickup:export", (payload) => {
        const p = payload || {};
        const wantStatus =
          p.status === "pending" || p.status === "all" ? p.status : "taken";
        const result = campaigns.searchPickup({
          ...p,
          status: wantStatus,
          limit: 5000,
          includeSignature: true,
        });
        socket.emit("pickup:export-data", result);
      });

      socket.on("pickup:mark", async (payload) => {
        const inv = ctx.services.inventory;
        // Reprints (already collected) must not consume stock and must not
        // be blocked when stock is 0 — only a NEW collection is blocked.
        const alreadyTaken = campaigns.isPickupTaken(payload?.campaignId, payload?.phone, payload?.personName);
        if (!alreadyTaken && inv?.isBlocked?.()) {
          socket.emit("pickup:done", {
            ok: false,
            error: "No aid left in inventory. Restock to continue collecting.",
            inventory: inv.publicState(),
          });
          return;
        }
        const result = campaigns.markTaken(
          payload?.campaignId,
          payload?.phone,
          payload?.personName,
          payload?.signature,
          payload?.requireSignature
        );
        if (!result.ok) {
          if (inv) result.inventory = inv.publicState();
          socket.emit("pickup:done", result);
          return;
        }
        // Decrement stock only for a genuine new collection.
        if (!result.alreadyTaken && inv) {
          result.inventory = await inv.decrement();
        } else if (inv) {
          result.inventory = inv.publicState();
        }
        socket.emit("pickup:done", result);
      });

      socket.on("pickup:reprint", (payload) => {
        const result = campaigns.reprintTaken(
          payload?.campaignId,
          payload?.phone,
          payload?.personName,
          payload?.signature,
          payload?.requireSignature
        );
        const inv = ctx.services.inventory;
        if (inv) result.inventory = inv.publicState();
        socket.emit("pickup:done", result);
      });

      socket.on("pickup:undo", async (payload) => {
        const result = campaigns.undoTaken(payload?.campaignId, payload?.phone, payload?.personName);
        const inv = ctx.services.inventory;
        // Undoing a collection returns the aid to stock (+1).
        if (result.ok && inv) {
          result.inventory = await inv.increment();
        } else if (inv) {
          result.inventory = inv.publicState();
        }
        socket.emit("pickup:done", result);
      });

      // --- Offline sync -----------------------------------------------------
      // The desk caches a full pickup snapshot locally so it can keep working
      // when this server is unreachable. On (re)connect it asks for a fresh
      // snapshot; after collecting offline it replays its queued ops here.
      socket.on("pickup:hydrate", () => {
        socket.emit("pickup:snapshot", campaigns.buildPickupSnapshot());
      });

      socket.on("pickup:apply-offline", async (payload) => {
        const ops = Array.isArray(payload?.ops) ? payload.ops : [];
        const results = [];
        for (const op of ops) {
          if (!op || typeof op !== "object") continue;
          try {
            const result = await campaigns.applyOfflineOp(op);
            results.push({ op, result });
          } catch (err) {
            ctx.logger?.error?.({ err }, "apply-offline op failed");
            results.push({ op, result: { ok: false, error: "Server error applying offline change." } });
          }
        }
        // Acknowledge this client with per-op outcomes (conflicts included).
        socket.emit("pickup:apply-offline:done", { results });
        // Broadcast a fresh snapshot so every tab reconciles its cache.
        ctx.io.emit("pickup:snapshot", campaigns.buildPickupSnapshot());
      });
    });
  },
};
