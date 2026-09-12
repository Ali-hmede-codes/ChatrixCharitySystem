import { toWhatsAppDigits } from "../../shared/phone.js";

// In-memory only — contacts are pushed to the WhatsApp phone's address
// book (the device) and that is the single source of truth. Chatrix does
// NOT keep a persisted list of saved contacts on the server; this cache only
// lives for the current process so we can skip re-saving within a session
// and show live progress in the UI. Nothing is written to disk.
export function createContactRepository(ctx) {
  const { CONTACTS_SYNC_VERSION } = ctx.config;
  let contacts = [];

  function load() {
    return contacts.map((item) => ({
      phone: toWhatsAppDigits(item.phone) || item.phone,
      name: String(item.name || "").trim() || `+${item.phone}`,
      savedAt: Number(item.savedAt) || Date.now(),
      alreadyOnWhatsApp: Boolean(item.alreadyOnWhatsApp),
      savedOnPrimary: Boolean(item.savedOnPrimary),
    }));
  }

  async function write(list) {
    contacts = Array.isArray(list) ? list : [];
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
    const index = contacts.findIndex((item) => item.phone === entry.phone);
    if (index >= 0) contacts[index] = { ...contacts[index], ...entry };
    else contacts.push(entry);
  }

  function listPublic() {
    return contacts.map(publicContact);
  }

  // Kept for compatibility; syncVersion is meaningless without persistence.
  return { load, write, upsert, publicContact, listPublic, syncVersion: CONTACTS_SYNC_VERSION };
}
