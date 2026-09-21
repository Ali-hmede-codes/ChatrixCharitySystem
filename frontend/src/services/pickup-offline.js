// Offline Aid Pickup logic — runs entirely against the cached snapshot
// when the server (Socket.io) is unreachable.
//
// Mirrors the backend's campaigns service (searchPickup / markTaken /
// reprintTaken / undoTaken / publicPickup / buildReceipt) so the desk
// behaves identically online and offline. The only difference: offline
// Aid IDs are allocated from a high offset (see aid-id.js) and the op is
// queued for replay on reconnect.
//
// Functions clone only the touched campaign/recipient (not the whole
// snapshot) so React gets a new reference and the cache is never mutated
// in place. Returns the new snapshot plus a result event shaped like the
// backend's `pickup:done` / `pickup:results` so the UI handler is shared.

import { namesEqual, nameCodeFor } from "./names.js";
import { matchesText, normalizeSearch } from "./search.js";
import { campaignDayKey, allocateOfflineAidId } from "./aid-id.js";
import { sanitizeSignature } from "./signature.js";

const PICKUP_RESULT_LIMIT = 80;

function cloneCampaign(campaign) {
  return {
    ...campaign,
    recipients: (campaign.recipients || []).map((r) => ({
      ...r,
      names: Array.isArray(r.names) ? [...r.names] : [],
      pickups: Array.isArray(r.pickups) ? r.pickups.map((p) => ({ ...p })) : [],
    })),
  };
}

function withCampaign(snapshot, campaignId, updater) {
  const campaigns = (snapshot.campaigns || []).map((c) => {
    if (c.id !== campaignId) return c;
    const clone = cloneCampaign(c);
    return updater(clone) || clone;
  });
  return { ...snapshot, campaigns };
}

function findPickup(recipient, personName) {
  const pickups = Array.isArray(recipient.pickups) ? recipient.pickups : [];
  const wanted = String(personName || "").replace(/\s+/g, " ").trim();
  if (!wanted) return pickups.length === 1 ? pickups[0] : null;
  return pickups.find((p) => namesEqual(p.name, wanted)) || null;
}

function slimPickup(pickup, includeSignature = false) {
  const signature = sanitizeSignature(pickup?.signature);
  const out = {
    name: pickup?.name || "",
    takenAt: pickup?.takenAt || null,
    takenAidId: pickup?.takenAidId || "",
    printCount: pickup?.printCount || 0,
    signed: Boolean(signature),
  };
  if (includeSignature && signature) out.signature = signature;
  return out;
}

function publicPickup(campaign, recipient, pickup, includeSignature = false) {
  const pickups = recipient.pickups || [];
  const familyNames = pickups.map((p) => p.name);
  const signature = sanitizeSignature(pickup.signature);
  const result = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignDate: campaign.createdAt,
    phone: recipient.phone,
    name: pickup.name,
    personName: pickup.name,
    names: familyNames,
    familyNames,
    familySize: pickups.length,
    familyTaken: pickups.filter((p) => p.takenAt).length,
    // Each person's own code (falls back to the recipient-level code).
    code: nameCodeFor(recipient, pickup.name) || recipient.code || "",
    state: recipient.state || "",
    channel: recipient.channel || "none",
    detail: recipient.detail || "",
    takenAt: pickup.takenAt || null,
    takenAidId: pickup.takenAidId || "",
    printCount: pickup.printCount || 0,
    signed: Boolean(signature),
    pickups: pickups.map((p) => slimPickup(p, includeSignature)),
  };
  if (includeSignature && signature) result.signature = signature;
  return result;
}

function buildReceipt(campaign, recipient, pickup, { reprint = false, branding = {} } = {}) {
  return {
    aidId: pickup.takenAidId || "",
    name: pickup.name || "Beneficiary",
    // Print this person's own pickup code on their own receipt.
    code: nameCodeFor(recipient, pickup.name) || recipient.code || "",
    campaignName: campaign.name || "",
    campaignDate: campaign.createdAt,
    takenAt: pickup.takenAt || Date.now(),
    reprint: Boolean(reprint),
    printCount: pickup.printCount || 1,
    logoUrl: branding.logoUrl || "",
    headerText: branding.headerText || "",
    paperWidthMm: branding.paperWidthMm || 80,
  };
}

function resolveDayFilter({ campaignDay, scope } = {}) {
  const raw = String(campaignDay || "").trim().toLowerCase();
  if (raw === "all") return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (scope === "today") return campaignDayKey(Date.now());
  return "";
}

function matchesPickupPerson(campaign, recipient, pickup, query) {
  if (!query) return true;
  const q = normalizeSearch(query);
  if (!q) return true;
  if (matchesText(pickup.name, q)) return true;
  if (matchesText(recipient.name, q)) return true;
  const personCode = nameCodeFor(recipient, pickup.name);
  if (matchesText(personCode, q)) return true;
  if (matchesText(recipient.code, q)) return true;
  if (matchesText(pickup.takenAidId, q)) return true;
  if (matchesText(campaign.name, q)) return true;
  const digitsQuery = String(query).replace(/\D/g, "");
  if (digitsQuery.length >= 3) {
    const targetDigits = String(recipient.phone || "").replace(/\D/g, "");
    if (targetDigits.includes(digitsQuery)) return true;
    const aidDigits = String(pickup.takenAidId || "").replace(/\D/g, "");
    if (aidDigits.includes(digitsQuery)) return true;
    const codeDigits = String(personCode || "").replace(/\D/g, "");
    if (codeDigits.includes(digitsQuery)) return true;
    const recipientCodeDigits = String(recipient.code || "").replace(/\D/g, "");
    if (recipientCodeDigits.includes(digitsQuery)) return true;
  }
  if (matchesText(recipient.phone, q)) return true;
  for (const name of recipient.names || []) {
    if (matchesText(name, q)) return true;
  }
  return false;
}

function pickupScore(pickup, recipient, query) {
  const q = normalizeSearch(query);
  if (!q) return 0;
  const code = normalizeSearch(nameCodeFor(recipient, pickup.name));
  const aid = normalizeSearch(pickup.takenAidId);
  const name = normalizeSearch(pickup.name);
  if (code && code === q) return 100;
  if (aid && aid === q) return 95;
  if (name && name === q) return 90;
  if (name && name.startsWith(q)) return 80;
  if (code && code.includes(q)) return 70;
  if (aid && aid.includes(q)) return 65;
  if (name && name.includes(q)) return 60;
  return 40;
}

export function searchPickupOffline(snapshot, payload = {}) {
  const campaigns = snapshot?.campaigns || [];
  const q = String(payload.query || "").trim();
  const day = resolveDayFilter(payload);
  const campId = String(payload.campaignId || "").trim();
  const wantStatus =
    payload.status === "pending" || payload.status === "taken" ? payload.status : "all";
  const maxItems = Math.min(
    Math.max(Number(payload.limit) || (wantStatus === "taken" ? 2000 : PICKUP_RESULT_LIMIT), 1),
    5000
  );
  const includeSignature = Boolean(payload.includeSignature);
  const items = [];

  for (const campaign of campaigns) {
    if (campId && campaign.id !== campId) continue;
    if (day && campaignDayKey(campaign.createdAt) !== day) continue;
    for (const recipient of campaign.recipients || []) {
      for (const pickup of recipient.pickups || []) {
        const taken = Boolean(pickup.takenAt);
        if (wantStatus === "pending" && taken) continue;
        if (wantStatus === "taken" && !taken) continue;
        if (q && !matchesPickupPerson(campaign, recipient, pickup, q)) continue;
        items.push({
          ...publicPickup(campaign, recipient, pickup, includeSignature),
          score: q ? pickupScore(pickup, recipient, q) : taken ? 10 : 50,
        });
      }
    }
  }

  items.sort((a, b) => {
    if (wantStatus === "taken") {
      return (Number(b.takenAt) || 0) - (Number(a.takenAt) || 0);
    }
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(a.takenAt) !== Boolean(b.takenAt)) return a.takenAt ? 1 : -1;
    const phoneCmp = String(a.phone || "").localeCompare(String(b.phone || ""));
    if (phoneCmp) return phoneCmp;
    return String(a.name || "").localeCompare(String(b.name || ""), "ar");
  });

  return {
    query: q,
    scope: day ? "day" : "all",
    campaignDay: day || "all",
    campaignId: campId,
    status: wantStatus,
    total: items.length,
    items: items.slice(0, maxItems).map(({ score, ...item }) => item),
  };
}

export function exportOffline(snapshot, payload = {}) {
  const p = payload || {};
  const wantStatus = p.status === "pending" || p.status === "all" ? p.status : "taken";
  return searchPickupOffline(snapshot, {
    ...p,
    status: wantStatus,
    limit: 5000,
    includeSignature: true,
  });
}

// --- mutations ---------------------------------------------------------------
// Each returns { snapshot, event, op }:
//   - snapshot: new cache snapshot after the change
//   - event:   shaped like the backend `pickup:done` event (fed to the
//              same UI handler as the online path)
//   - op:      queued operation to replay on reconnect (null if nothing
//              to sync, e.g. an error or an already-taken reprint request)

export function markOffline(snapshot, inventory, args, branding = {}) {
  const { campaignId, phone, personName, signature } = args;
  const cleanedSignature = sanitizeSignature(signature);
  const campaign = (snapshot?.campaigns || []).find((c) => c.id === campaignId);
  if (!campaign) {
    return { snapshot, event: { ok: false, error: "Campaign not found." }, op: null };
  }
  const recipient = (campaign.recipients || []).find((r) => r.phone === phone);
  if (!recipient) {
    return { snapshot, event: { ok: false, error: "Person not found in this campaign." }, op: null };
  }
  const pickup = findPickup(recipient, personName);
  if (!pickup) {
    return {
      snapshot,
      event: {
        ok: false,
        error: "Choose which family member is collecting. Each person gets their own bill.",
      },
      op: null,
    };
  }

  // Already collected -> reprint path. No stock consumed, not blocked at 0.
  if (pickup.takenAt) {
    const hadSignature = Boolean(sanitizeSignature(pickup.signature));
    let nextSnapshot = snapshot;
    if (cleanedSignature && !hadSignature) {
      nextSnapshot = withCampaign(snapshot, campaignId, (clone) => {
        const r = (clone.recipients || []).find((x) => x.phone === phone);
        const p = findPickup(r, personName);
        if (p && !p.signature) {
          p.signature = cleanedSignature;
          r.updatedAt = Date.now();
        }
      });
    }
    const updatedCampaign = nextSnapshot.campaigns.find((c) => c.id === campaignId) || campaign;
    const updatedRecipient =
      (updatedCampaign.recipients || []).find((r) => r.phone === phone) || recipient;
    const updatedPickup = findPickup(updatedRecipient, personName) || pickup;
    const event = {
      ok: true,
      alreadyTaken: true,
      reprint: false,
      receipt: buildReceipt(updatedCampaign, updatedRecipient, updatedPickup, { reprint: true, branding }),
      recipient: publicPickup(updatedCampaign, updatedRecipient, updatedPickup, true),
      inventory,
    };
    const op =
      cleanedSignature && !hadSignature
        ? {
            op: "reprint",
            campaignId,
            phone,
            personName: updatedPickup.name,
            printCount: Number(updatedPickup.printCount) || 1,
            signature: cleanedSignature,
          }
        : null;
    return { snapshot: nextSnapshot, event, op };
  }

  if (!cleanedSignature) {
    return {
      snapshot,
      event: { ok: false, error: "Ask the person to sign before printing." },
      op: null,
    };
  }

  // Block new collections when out of stock — mirrors the backend.
  if (Number(inventory?.count) <= 0) {
    return {
      snapshot,
      event: {
        ok: false,
        error: "No aid left in inventory. Restock to continue collecting.",
        inventory,
      },
      op: null,
    };
  }

  const dayKey = campaignDayKey(campaign.createdAt);
  const { aidId } = allocateOfflineAidId(snapshot.campaigns, dayKey);
  const takenAt = Date.now();

  let nextSnapshot = withCampaign(snapshot, campaignId, (clone) => {
    const r = (clone.recipients || []).find((x) => x.phone === phone);
    const p = findPickup(r, personName);
    if (p) {
      p.takenAidId = aidId;
      p.takenAt = takenAt;
      p.printCount = (Number(p.printCount) || 0) + 1;
      p.signature = cleanedSignature;
    }
    r.updatedAt = takenAt;
  });

  const nextInventory = {
    ...inventory,
    count: Math.max(0, (Number(inventory?.count) || 0) - 1),
    updatedAt: takenAt,
  };
  nextSnapshot = { ...nextSnapshot, inventory: nextInventory };

  const updatedCampaign = nextSnapshot.campaigns.find((c) => c.id === campaignId);
  const updatedRecipient = updatedCampaign.recipients.find((r) => r.phone === phone);
  const updatedPickup = findPickup(updatedRecipient, personName);

  const event = {
    ok: true,
    alreadyTaken: false,
    reprint: false,
    receipt: buildReceipt(updatedCampaign, updatedRecipient, updatedPickup, {
      reprint: false,
      branding,
    }),
    recipient: publicPickup(updatedCampaign, updatedRecipient, updatedPickup, true),
    inventory: nextInventory,
  };

  const op = {
    op: "mark",
    campaignId,
    phone,
    personName: updatedPickup.name,
    takenAt,
    takenAidId: aidId,
    signature: cleanedSignature,
  };

  return { snapshot: nextSnapshot, event, op };
}

export function reprintOffline(snapshot, inventory, args, branding = {}) {
  const { campaignId, phone, personName, signature } = args;
  const cleanedSignature = sanitizeSignature(signature);
  const campaign = (snapshot?.campaigns || []).find((c) => c.id === campaignId);
  if (!campaign) {
    return { snapshot, event: { ok: false, error: "Campaign not found." }, op: null };
  }
  const recipient = (campaign.recipients || []).find((r) => r.phone === phone);
  if (!recipient) {
    return { snapshot, event: { ok: false, error: "Person not found in this campaign." }, op: null };
  }
  const pickup = findPickup(recipient, personName);
  if (!pickup) {
    return { snapshot, event: { ok: false, error: "Choose which family member to reprint." }, op: null };
  }
  if (!pickup.takenAt || !pickup.takenAidId) {
    return {
      snapshot,
      event: { ok: false, error: "This person has not collected aid yet." },
      op: null,
    };
  }
  if (!sanitizeSignature(pickup.signature) && !cleanedSignature) {
    return {
      snapshot,
      event: { ok: false, error: "Ask the person to sign before printing." },
      op: null,
    };
  }

  const nextSnapshot = withCampaign(snapshot, campaignId, (clone) => {
    const r = (clone.recipients || []).find((x) => x.phone === phone);
    const p = findPickup(r, personName);
    if (p) {
      p.printCount = (Number(p.printCount) || 1) + 1;
      if (cleanedSignature && !p.signature) p.signature = cleanedSignature;
      r.updatedAt = Date.now();
    }
  });

  const updatedCampaign = nextSnapshot.campaigns.find((c) => c.id === campaignId);
  const updatedRecipient = updatedCampaign.recipients.find((r) => r.phone === phone);
  const updatedPickup = findPickup(updatedRecipient, personName);

  const event = {
    ok: true,
    alreadyTaken: true,
    reprint: true,
    receipt: buildReceipt(updatedCampaign, updatedRecipient, updatedPickup, {
      reprint: true,
      branding,
    }),
    recipient: publicPickup(updatedCampaign, updatedRecipient, updatedPickup, true),
    inventory,
  };

  // Reprint only bumps printCount — replay it so the server's count matches.
  // Include the target printCount so a re-flush (lost ack) is idempotent: the
  // server takes max(current, target) instead of incrementing again.
  const op = {
    op: "reprint",
    campaignId,
    phone,
    personName: updatedPickup.name,
    printCount: Number(updatedPickup.printCount) || 1,
    signature: sanitizeSignature(updatedPickup.signature) || cleanedSignature || "",
  };

  return { snapshot: nextSnapshot, event, op };
}

export function undoOffline(snapshot, inventory, args) {
  const { campaignId, phone, personName } = args;
  const campaign = (snapshot?.campaigns || []).find((c) => c.id === campaignId);
  if (!campaign) {
    return { snapshot, event: { ok: false, error: "Campaign not found." }, op: null };
  }
  const recipient = (campaign.recipients || []).find((r) => r.phone === phone);
  if (!recipient) {
    return { snapshot, event: { ok: false, error: "Person not found in this campaign." }, op: null };
  }
  const pickup = findPickup(recipient, personName);
  if (!pickup) {
    return { snapshot, event: { ok: false, error: "Choose which family member to undo." }, op: null };
  }
  if (!pickup.takenAt) {
    return { snapshot, event: { ok: false, error: "This person is not marked as collected." }, op: null };
  }

  const takenAidId = pickup.takenAidId || "";
  let nextSnapshot = withCampaign(snapshot, campaignId, (clone) => {
    const r = (clone.recipients || []).find((x) => x.phone === phone);
    const p = findPickup(r, personName);
    if (p) {
      p.takenAt = null;
      p.signature = "";
      // Keep takenAidId so the same ID is reused if they collect again.
    }
    r.updatedAt = Date.now();
  });

  const nextInventory = {
    ...inventory,
    count: (Number(inventory?.count) || 0) + 1,
    updatedAt: Date.now(),
  };
  nextSnapshot = { ...nextSnapshot, inventory: nextInventory };

  const updatedCampaign = nextSnapshot.campaigns.find((c) => c.id === campaignId);
  const updatedRecipient = updatedCampaign.recipients.find((r) => r.phone === phone);
  const updatedPickup = findPickup(updatedRecipient, personName);

  const event = {
    ok: true,
    undone: true,
    recipient: publicPickup(updatedCampaign, updatedRecipient, updatedPickup),
    inventory: nextInventory,
  };

  const op = {
    op: "undo",
    campaignId,
    phone,
    personName: updatedPickup.name,
    takenAidId,
  };

  return { snapshot: nextSnapshot, event, op };
}

// Build a receipt for an offline mark that has just been applied — used to
// re-print from the queue if needed. Kept for completeness; the mark path
// already returns the receipt in `event`.
export function receiptFromSnapshot(snapshot, args) {
  const campaign = (snapshot?.campaigns || []).find((c) => c.id === args.campaignId);
  if (!campaign) return null;
  const recipient = (campaign.recipients || []).find((r) => r.phone === args.phone);
  if (!recipient) return null;
  const pickup = findPickup(recipient, args.personName);
  if (!pickup) return null;
  return buildReceipt(campaign, recipient, pickup, { reprint: false, branding: {} });
}

// --- cache keep-fresh (online incremental updates) ---------------------------
// While online, the cache must stay current so that a later disconnect
// reflects the most recent online collections. These helpers merge a live
// `campaigns:recipient` / inventory event into the cached snapshot without
// replacing the whole thing.

export function applyRecipientEventToSnapshot(snapshot, event) {
  const campaignId = event?.campaignId;
  const recipient = event?.recipient;
  if (!campaignId || !recipient || !recipient.phone) return snapshot;
  const campaigns = (snapshot?.campaigns || []).map((c) => {
    if (c.id !== campaignId) return c;
    const recipients = (c.recipients || []).map((r) => {
      if (r.phone !== recipient.phone) return r;
      const pickups = Array.isArray(recipient.pickups)
        ? recipient.pickups.map((p) => {
            const prev = (r.pickups || []).find((x) => namesEqual(x.name, p.name)) || {};
            const fromFocused =
              event.pickup && namesEqual(event.pickup.name || event.pickup.personName, p.name)
                ? event.pickup.signature
                : "";
            return {
              name: p.name,
              takenAt: p.takenAt ? Number(p.takenAt) : null,
              takenAidId: String(p.takenAidId || "").trim(),
              printCount: Number(p.printCount) || 0,
              signature:
                sanitizeSignature(p.signature) ||
                sanitizeSignature(fromFocused) ||
                sanitizeSignature(prev.signature) ||
                "",
            };
          })
        : r.pickups;
      return {
        ...r,
        name: recipient.name || r.name,
        names: Array.isArray(recipient.names) ? recipient.names : r.names,
        code: recipient.code || r.code,
        nameCodes: recipient.nameCodes != null ? recipient.nameCodes : r.nameCodes,
        state: recipient.state || r.state,
        channel: recipient.channel || r.channel,
        detail: recipient.detail || r.detail,
        pickups,
      };
    });
    return { ...c, recipients };
  });
  return { ...snapshot, campaigns };
}

export function applyInventoryToSnapshot(snapshot, inventory) {
  if (!inventory) return snapshot;
  return { ...snapshot, inventory: { ...inventory } };
}


