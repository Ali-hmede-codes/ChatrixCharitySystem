import { delay } from "../../shared/delay.js";
import { firstNameFrom, namesEqual, namesFromRecipient } from "../../shared/names.js";
import { toWhatsAppDigits } from "../../shared/phone.js";
import { createContactRepository } from "./repository.js";

export function createContactsService(ctx) {
  const repo = createContactRepository(ctx);
  let savingContacts = false;

  async function saveWhatsAppContact({ phone, name }, lookup) {
    const whatsapp = ctx.services.whatsapp;
    const client = whatsapp?.getClient?.();
    const digits = toWhatsAppDigits(phone);
    if (!digits) return { status: "invalid", phone: String(phone || ""), name: String(name || "") };
    const excelName = String(name || "").replace(/\s+/g, " ").trim();
    const local = repo.load();
    const existing = local.find((item) => item.phone === digits);
    const stored = await whatsapp.findStoredContact(digits);
    const currentName = String(existing?.name || stored?.displayName || "").replace(/\s+/g, " ").trim();
    const fullName = excelName || currentName || `+${digits}`;

    const resolved = lookup || (await whatsapp.lookupNumbers([digits])).get(digits);
    if (!resolved || resolved.exists === null) {
      return {
        status: "failed",
        phone: digits,
        name: fullName,
        detail: "Could not check if this number is on WhatsApp",
      };
    }
    if (resolved.invalid || resolved.exists === false) {
      return {
        status: "unavailable",
        phone: digits,
        name: fullName,
        detail: resolved.invalid ? "Not a WhatsApp number" : "Not on WhatsApp",
      };
    }

    const alreadyPrimary = Boolean(existing?.savedOnPrimary);
    if (alreadyPrimary && namesEqual(fullName, existing.name)) {
      return { status: "exists", phone: digits, name: fullName };
    }

    if (!client?.chat?.set) {
      return { status: "failed", phone: digits, name: fullName, detail: "WhatsApp is not linked" };
    }

    const firstName = firstNameFrom(fullName);
    const isUpdate = alreadyPrimary && excelName && !namesEqual(excelName, existing.name);

    try {
      await client.chat.set({
        schema: "Contact",
        id: resolved.pnJid,
        fullName,
        firstName,
        pnJid: resolved.pnJid,
        lidJid: resolved.lidJid || undefined,
        saveOnPrimaryAddressbook: true,
      });
      if (resolved.lidJid) {
        try {
          await client.chat.set({
            schema: "LidContact",
            id: resolved.lidJid,
            fullName,
            firstName,
          });
        } catch {
          // LID record is best-effort; the PN contact already synced.
        }
        try {
          await client.chat.set({
            schema: "PnForLidChat",
            lid: resolved.lidJid,
            pnJid: resolved.pnJid,
          });
        } catch {
          // Link record is best-effort.
        }
      }
      if (typeof client.chat.flushMutations === "function") {
        await client.chat.flushMutations();
      }
      await repo.upsert({
        phone: digits,
        name: fullName,
        savedAt: Date.now(),
        alreadyOnWhatsApp: true,
        savedOnPrimary: true,
      });
      return {
        status: isUpdate ? "updated" : "saved",
        phone: digits,
        name: fullName,
      };
    } catch (error) {
      const detail = String(error?.message || "Could not save contact");
      return {
        status: "failed",
        phone: digits,
        name: fullName,
        detail: /blocked|incomplete/i.test(detail)
          ? "WhatsApp blocked contact sync. Keep the charity phone online and try again."
          : detail,
      };
    }
  }

  function emitList(socket) {
    const payload = { contacts: repo.listPublic() };
    if (socket) socket.emit("contacts:data", payload);
    else ctx.io.emit("contacts:data", payload);
  }

  async function saveBatch(payload, socket) {
    if (savingContacts) {
      socket.emit("contacts:error", "A contact save is already running.");
      return;
    }
    if (ctx.services.send?.isRunning?.()) {
      socket.emit("contacts:error", "Wait until the WhatsApp send finishes.");
      return;
    }
    if (!ctx.services.whatsapp?.isOpen?.()) {
      socket.emit("contacts:error", "Link WhatsApp with the QR code first.");
      return;
    }

    const incoming = Array.isArray(payload?.contacts) ? payload.contacts : [];
    const unique = [];
    const seen = new Set();
    for (const item of incoming) {
      const phone = toWhatsAppDigits(item?.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      unique.push({
        phone,
        name: namesFromRecipient(item).join(" + ") || String(item?.name || "").replace(/\s+/g, " ").trim(),
      });
      if (unique.length >= ctx.config.MAX_PEOPLE) break;
    }

    if (!unique.length) {
      socket.emit("contacts:error", "No numbers to save.");
      return;
    }

    savingContacts = true;
    let saved = 0;
    let updated = 0;
    let exists = 0;
    let skipped = 0;
    let failed = 0;

    ctx.io.emit("contacts:progress", {
      index: 0,
      total: unique.length,
      phone: "",
      name: "",
      state: "saving",
      detail: "Checking which numbers are on WhatsApp…",
    });
    const lookups = await ctx.services.whatsapp.lookupNumbers(unique.map((item) => item.phone));

    for (let index = 0; index < unique.length; index += 1) {
      const item = unique[index];
      ctx.io.emit("contacts:progress", {
        index,
        total: unique.length,
        phone: `+${item.phone}`,
        name: item.name,
        state: "saving",
        detail: "Checking…",
      });
      const result = await saveWhatsAppContact(item, lookups.get(item.phone));
      if (result.status === "saved") {
        saved += 1;
        ctx.io.emit("contacts:progress", {
          index,
          total: unique.length,
          phone: `+${result.phone}`,
          name: result.name,
          state: "saved",
          detail: "Saved on the charity phone",
        });
      } else if (result.status === "updated") {
        updated += 1;
        ctx.io.emit("contacts:progress", {
          index,
          total: unique.length,
          phone: `+${result.phone}`,
          name: result.name,
          state: "updated",
          detail: "Updated name on the charity phone",
        });
      } else if (result.status === "exists") {
        exists += 1;
        ctx.io.emit("contacts:progress", {
          index,
          total: unique.length,
          phone: `+${result.phone}`,
          name: result.name,
          state: "exists",
          detail: "Name already current",
        });
      } else if (result.status === "unavailable") {
        skipped += 1;
        ctx.io.emit("contacts:progress", {
          index,
          total: unique.length,
          phone: `+${result.phone || item.phone}`,
          name: result.name || item.name,
          state: "skipped",
          detail: result.detail || "Not on WhatsApp",
        });
      } else {
        failed += 1;
        ctx.io.emit("contacts:progress", {
          index,
          total: unique.length,
          phone: `+${result.phone || item.phone}`,
          name: result.name || item.name,
          state: "failed",
          detail: result.detail || "Could not save",
        });
      }
      if (index < unique.length - 1) await delay(400);
    }

    savingContacts = false;
    emitList();
    ctx.io.emit("contacts:done", { saved, updated, exists, skipped, failed, total: unique.length });
  }

  async function check(payload, socket) {
    if (savingContacts) {
      socket.emit("contacts:checked", { results: [], error: "Wait until the current contact job finishes." });
      return;
    }
    if (ctx.services.send?.isRunning?.()) {
      socket.emit("contacts:checked", { results: [], error: "Wait until the WhatsApp send finishes." });
      return;
    }
    if (!ctx.services.whatsapp?.isOpen?.()) {
      socket.emit("contacts:checked", { results: [], error: "Link WhatsApp with the QR code first." });
      return;
    }
    const incoming = Array.isArray(payload?.phones) ? payload.phones : [];
    savingContacts = true;
    try {
      const lookups = await ctx.services.whatsapp.lookupNumbers(incoming);
      const results = [];
      lookups.forEach((item, digits) => {
        results.push({
          phone: `+${digits}`,
          exists: item.exists === true,
          invalid: Boolean(item.invalid),
        });
      });
      socket.emit("contacts:checked", { results });
    } catch {
      socket.emit("contacts:checked", { results: [], error: "Could not check WhatsApp." });
    } finally {
      savingContacts = false;
    }
  }

  return {
    isBusy: () => savingContacts,
    emitList,
    saveBatch,
    check,
  };
}
