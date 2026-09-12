import { createJsonStore } from "../../infrastructure/json-file.js";
import { toWhatsAppDigits } from "../../shared/phone.js";

export function createContactRepository(ctx) {
  const { CONTACTS_PATH, CONTACTS_SYNC_VERSION } = ctx.config;
  const store = createJsonStore(CONTACTS_PATH, { syncVersion: CONTACTS_SYNC_VERSION, contacts: [] });

  function load() {
    const raw = store.read();
    const list = Array.isArray(raw?.contacts) ? raw.contacts : Array.isArray(raw) ? raw : [];
    const trustPrimary = Number(raw?.syncVersion) >= CONTACTS_SYNC_VERSION;
    return list
      .map((item) => {
        const phone = toWhatsAppDigits(item?.phone);
        const name = String(item?.name || "").trim();
        if (!phone) return null;
        return {
          phone,
          name: name || `+${phone}`,
          savedAt: Number(item.savedAt) || Date.now(),
          alreadyOnWhatsApp: Boolean(item.alreadyOnWhatsApp),
          savedOnPrimary: trustPrimary && Boolean(item.savedOnPrimary),
        };
      })
      .filter(Boolean);
  }

  async function write(list) {
    await store.write({ syncVersion: CONTACTS_SYNC_VERSION, contacts: list });
  }

  function publicContact(item) {
    return {
      phone: `+${item.phone}`,
      name: item.name,
      savedAt: item.savedAt,
      alreadyOnWhatsApp: Boolean(item.alreadyOnWhatsApp),
      savedOnPrimary: Boolean(item.savedOnPrimary),
    };
  }

  async function upsert(entry) {
    const local = load();
    const index = local.findIndex((item) => item.phone === entry.phone);
    if (index >= 0) local[index] = { ...local[index], ...entry };
    else local.push(entry);
    await write(local);
  }

  function listPublic() {
    return load().map(publicContact);
  }

  return { load, write, upsert, publicContact, listPublic };
}
