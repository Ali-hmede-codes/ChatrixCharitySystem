import { parsePhoneJid } from "zapo-js";
import { delay } from "../../shared/delay.js";
import { toWhatsAppDigits } from "../../shared/phone.js";

export function createWhatsAppDirectory({ getClient, getStore, getSessionId }) {
  async function lookupWhatsAppNumbers(phones) {
    const client = getClient();
    const unique = [];
    const seen = new Set();
    for (const value of phones) {
      const digits = toWhatsAppDigits(value);
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      unique.push(digits);
    }
    const byPhone = new Map();
    if (!client?.profile?.getLidsByPhoneNumbers) {
      unique.forEach((digits) => {
        byPhone.set(digits, {
          pnJid: parsePhoneJid(digits),
          lidJid: null,
          exists: null,
          invalid: false,
        });
      });
      return byPhone;
    }
    const chunkSize = 20;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      try {
        const results = await client.profile.getLidsByPhoneNumbers(chunk);
        const byQueried = new Map();
        for (const item of results || []) {
          if (item?.queriedJid) byQueried.set(item.queriedJid, item);
          const key = toWhatsAppDigits(item?.queriedJid || item?.phoneJid);
          if (key && !byQueried.has(key)) byQueried.set(key, item);
        }
        for (const digits of chunk) {
          const pnJid = parsePhoneJid(digits);
          const hit = byQueried.get(pnJid) || byQueried.get(digits);
          if (!hit) {
            byPhone.set(digits, { pnJid, lidJid: null, exists: false, invalid: false });
            continue;
          }
          byPhone.set(digits, {
            pnJid: hit.phoneJid || pnJid,
            lidJid: hit.lidJid || null,
            exists: Boolean(hit.exists) && !hit.invalid,
            invalid: Boolean(hit.invalid),
          });
        }
      } catch {
        for (const digits of chunk) {
          byPhone.set(digits, {
            pnJid: parsePhoneJid(digits),
            lidJid: null,
            exists: null,
            invalid: false,
          });
        }
      }
      if (i + chunkSize < unique.length) await delay(400);
    }
    return byPhone;
  }

  async function findStoredContact(digits, lidJid) {
    const store = getStore();
    if (!store || !digits) return null;
    try {
      const contacts = store.session(getSessionId()).contacts;
      if (!contacts) return null;
      const jid = parsePhoneJid(digits);
      return (
        (lidJid && (await contacts.getByJid(lidJid))) ||
        (await contacts.getByJid(jid)) ||
        (await contacts.getByPhoneNumber(digits)) ||
        (await contacts.getByPhoneNumber(`+${digits}`)) ||
        (await contacts.getByPhoneNumber(jid))
      );
    } catch {
      return null;
    }
  }

  async function resolveTarget(phone) {
    const client = getClient();
    const digits = toWhatsAppDigits(phone);
    if (!digits) throw new Error("Not a +961 or +963 number");

    try {
      const results = await client.profile.getLidsByPhoneNumbers([digits]);
      const hit = Array.isArray(results) ? results.find((item) => item?.exists && !item?.invalid) : null;
      if (!hit) return { skip: true, reason: "Not on WhatsApp" };
      return { skip: false, jid: hit.lidJid || hit.phoneJid || parsePhoneJid(digits) };
    } catch {
      return { skip: false, jid: parsePhoneJid(digits) };
    }
  }

  return { lookupWhatsAppNumbers, findStoredContact, resolveTarget };
}
