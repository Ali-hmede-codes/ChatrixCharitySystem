import { createCampaignRepository } from "./repository.js";
import { plusPhone } from "../../shared/phone.js";
import { namesFromRecipient, namesEqual, personSlots } from "../../shared/names.js";
import { matchesText, normalizeSearch } from "../../shared/search.js";
import { campaignDayKey, formatAidId, maxAidSeqForDay } from "../../shared/aid-id.js";
import { isRecipientPending, pauseCopy } from "../send/interrupt.js";

const PICKUP_RESULT_LIMIT = 80;

export function createCampaignService(ctx) {
  const repo = createCampaignRepository(ctx);
  let campaigns = repo.load();
  let aidSeq = repo.loadSeq();
  let saveTimer = null;
  let seqSaveTimer = null;

  recoverStaleRunning();
  for (const campaign of campaigns) recountStats(campaign);
  scheduleSave();

  function recoverStaleRunning() {
    let changed = false;
    for (const campaign of campaigns) {
      if (campaign.status !== "running") continue;
      campaign.status = "interrupted";
      campaign.pauseReason = "server_restart";
      campaign.pausedAt = Date.now();
      for (const recipient of campaign.recipients || []) {
        if (recipient.state === "sending") {
          recipient.state = "retry";
          recipient.detail = pauseCopy("server_restart").detail;
          recipient.updatedAt = Date.now();
        }
      }
      recountStats(campaign);
      changed = true;
    }
    if (changed) scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await repo.write(campaigns);
      } catch (err) {
        ctx.logger.error({ err }, "failed saving campaigns to disk");
      }
    }, 1_000);
  }

  function scheduleSeqSave() {
    if (seqSaveTimer) return;
    seqSaveTimer = setTimeout(async () => {
      seqSaveTimer = null;
      try {
        await repo.writeSeq(aidSeq);
      } catch (err) {
        ctx.logger.error({ err }, "failed saving aid sequence to disk");
      }
    }, 400);
  }

  function allocateAidId(campaign) {
    const dayKey = campaignDayKey(campaign.createdAt);
    const scanned = maxAidSeqForDay(campaigns, dayKey);
    const stored = Number(aidSeq[dayKey]) || 0;
    const next = Math.max(scanned, stored) + 1;
    aidSeq = { ...aidSeq, [dayKey]: next };
    scheduleSeqSave();
    return formatAidId(dayKey, next);
  }

  function ensurePickups(recipient) {
    if (!recipient) return [];
    const slots = personSlots(recipient);
    const existing = Array.isArray(recipient.pickups) ? recipient.pickups : [];
    const byKey = new Map();
    for (const pickup of existing) {
      const name = String(pickup?.name || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      byKey.set(name.toLowerCase(), {
        name,
        takenAt: pickup.takenAt ? Number(pickup.takenAt) : null,
        takenAidId: String(pickup.takenAidId || "").trim(),
        printCount: Number(pickup.printCount) || 0,
      });
    }

    recipient.pickups = slots.map((name) => {
      const found = byKey.get(name.toLowerCase());
      if (found) return { ...found, name };
      return { name, takenAt: null, takenAidId: "", printCount: 0 };
    });
    if (slots.length > 1) {
      recipient.names = slots;
      recipient.name = slots.join(" + ");
    }

    const anyPickupTaken = recipient.pickups.some((p) => p.takenAt);
    if (recipient.takenAt && !anyPickupTaken) {
      for (const pickup of recipient.pickups) {
        pickup.takenAt = Number(recipient.takenAt);
        pickup.takenAidId = pickup.takenAidId || String(recipient.takenAidId || "");
        pickup.printCount = pickup.printCount || Number(recipient.printCount) || 1;
      }
    }

    const taken = recipient.pickups.filter((p) => p.takenAt);
    if (taken.length === recipient.pickups.length && taken.length > 0) {
      const last = taken[taken.length - 1];
      recipient.takenAt = last.takenAt;
      recipient.takenAidId = last.takenAidId;
      recipient.printCount = last.printCount;
    } else if (taken.length === 1 && recipient.pickups.length === 1) {
      recipient.takenAt = taken[0].takenAt;
      recipient.takenAidId = taken[0].takenAidId;
      recipient.printCount = taken[0].printCount;
    } else {
      recipient.takenAt = taken.length ? taken[taken.length - 1].takenAt : null;
      recipient.takenAidId = taken.length ? taken.map((p) => p.takenAidId).filter(Boolean).join(", ") : "";
    }
    return recipient.pickups;
  }

  function findPickup(recipient, personName) {
    const pickups = ensurePickups(recipient);
    const wanted = String(personName || "").replace(/\s+/g, " ").trim();
    if (!wanted) {
      return pickups.length === 1 ? pickups[0] : null;
    }
    return pickups.find((p) => namesEqual(p.name, wanted)) || null;
  }

  function publicPickup(campaign, recipient, pickup) {
    const pickups = ensurePickups(recipient);
    const familyNames = pickups.map((p) => p.name);
    return {
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
      code: recipient.code || "",
      state: recipient.state,
      channel: recipient.channel || "none",
      detail: recipient.detail || "",
      takenAt: pickup.takenAt || null,
      takenAidId: pickup.takenAidId || "",
      printCount: pickup.printCount || 0,
      pickups,
    };
  }

  function publicRecipient(campaign, recipient) {
    const pickups = ensurePickups(recipient);
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignDate: campaign.createdAt,
      phone: recipient.phone,
      name: recipient.name || "",
      names: Array.isArray(recipient.names) ? recipient.names : pickups.map((p) => p.name),
      pickups,
      familySize: pickups.length,
      familyTaken: pickups.filter((p) => p.takenAt).length,
      code: recipient.code || "",
      state: recipient.state,
      channel: recipient.channel || "none",
      detail: recipient.detail || "",
      takenAt: recipient.takenAt || null,
      takenAidId: recipient.takenAidId || "",
      printCount: recipient.printCount || 0,
    };
  }

  function buildReceipt(campaign, recipient, pickup, { reprint = false } = {}) {
    const brand = ctx.services.brand?.publicBrand?.() || {};
    const printer = ctx.services.printer?.publicSettings?.() || {};
    return {
      aidId: pickup.takenAidId || "",
      name: pickup.name || "Beneficiary",
      code: recipient.code || "",
      campaignName: campaign.name || "",
      campaignDate: campaign.createdAt,
      takenAt: pickup.takenAt || Date.now(),
      reprint: Boolean(reprint),
      printCount: pickup.printCount || 1,
      logoUrl: brand.url || "",
      headerText: printer.headerText || "",
      paperWidthMm: printer.paperWidthMm || 80,
    };
  }

  function emitRecipient(campaign, recipient, pickup = null) {
    const payload = {
      campaignId: campaign.id,
      recipient: publicRecipient(campaign, recipient),
      pickup: pickup ? publicPickup(campaign, recipient, pickup) : null,
      personName: pickup?.name || "",
      stats: { ...campaign.stats },
    };
    ctx.io.emit("campaigns:recipient", payload);
    ctx.io.emit("campaigns:update", publicSummary(campaign));
  }

  function findRecipient(campaign, phone) {
    const formatted = plusPhone(phone);
    return (campaign.recipients || []).find((r) => r.phone === formatted) || null;
  }

  function remainingOf(campaign) {
    return (campaign?.recipients || []).filter(isRecipientPending);
  }

  function recountStats(campaign) {
    if (!campaign) return;
    if (!campaign.stats) campaign.stats = {};
    const rec = campaign.recipients || [];
    campaign.stats.failed = rec.filter((r) => r.state === "failed").length;
    campaign.stats.skipped = rec.filter((r) => r.state === "skipped").length;
    campaign.stats.taken = rec.reduce(
      (sum, r) => sum + ensurePickups(r).filter((p) => Boolean(p.takenAt)).length,
      0
    );
    campaign.stats.people = rec.reduce((sum, r) => sum + ensurePickups(r).length, 0);
    campaign.stats.delivered = rec.filter((r) => r.state === "delivered").length;
    campaign.stats.waiting = rec.filter((r) => r.state === "waiting").length;
    campaign.stats.smsSent = rec.filter((r) => r.state === "sms-sent").length;
    campaign.stats.smsFailed = rec.filter((r) => r.state === "sms-failed").length;
    campaign.stats.sent = rec.filter((r) =>
      ["waiting", "delivered", "sms-sent", "sms-failed", "undelivered", "sms-queued"].includes(r.state)
    ).length;
    campaign.stats.undelivered = rec.filter((r) =>
      ["undelivered", "sms-sent", "sms-failed", "sms-queued"].includes(r.state)
    ).length;
    campaign.totalRecipients = rec.length;
  }

  function publicSummary(c) {
    const remaining = remainingOf(c).length;
    return {
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
      pausedAt: c.pausedAt || null,
      status: c.status,
      pauseReason: c.pauseReason || null,
      enableSms: Boolean(c.enableSms),
      message: c.message,
      aidCode: c.aidCode || "",
      senderPhone: c.senderPhone || "",
      totalRecipients: c.totalRecipients,
      totalPeople: Number(c.stats?.people) || c.totalRecipients,
      remainingCount: remaining,
      resumable: c.status !== "completed" && remaining > 0,
      stats: { ...c.stats },
    };
  }

  function list() {
    return campaigns.map(publicSummary);
  }

  function listResumable() {
    return list().filter((c) => c.resumable);
  }

  function get(id) {
    const found = campaigns.find((c) => c.id === String(id));
    if (!found) return null;
    for (const recipient of found.recipients || []) ensurePickups(recipient);
    recountStats(found);
    return {
      ...publicSummary(found),
      sendOptions: { ...found.sendOptions },
      recipients: found.recipients || [],
    };
  }

  function remainingRecipients(id) {
    const found = campaigns.find((c) => c.id === String(id));
    if (!found) return [];
    return remainingOf(found).map((r) => ({
      phone: r.phone,
      names: namesFromRecipient(r),
      name: r.name || "",
      code: r.code || "",
      sentNames: Array.isArray(r.sentNames) ? r.sentNames : [],
    }));
  }

  function remainingCount(id) {
    const found = campaigns.find((c) => c.id === String(id));
    return found ? remainingOf(found).length : 0;
  }

  async function create({
    name,
    message,
    recipients = [],
    enableSms = false,
    aidCode = "",
    sendOptions = {},
    senderPhone = "",
  }) {
    const rawName = String(name || "").trim();
    const defaultTitle = `Campaign ${new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    const newCampaign = {
      id: `camp-${Date.now()}`,
      name: rawName || defaultTitle,
      createdAt: Date.now(),
      completedAt: null,
      pausedAt: null,
      status: "running",
      pauseReason: null,
      enableSms: Boolean(enableSms) && Boolean(ctx.services.sms?.ready?.()),
      message: String(message || "").trim(),
      aidCode: String(aidCode || "").trim().slice(0, 80),
      senderPhone: String(senderPhone || "").trim(),
      sendOptions: {
        message: String(sendOptions.message || message || "").trim(),
        useNameTemplate: Boolean(sendOptions.useNameTemplate),
        nameTemplate: String(sendOptions.nameTemplate || ""),
        enableSms: Boolean(enableSms) && Boolean(ctx.services.sms?.ready?.()),
      },
      totalRecipients: recipients.length,
      stats: {
        sent: 0,
        delivered: 0,
        waiting: 0,
        undelivered: 0,
        smsSent: 0,
        smsFailed: 0,
        failed: 0,
        skipped: 0,
        taken: 0,
        people: 0,
      },
      recipients: recipients
        .map((r) => {
          const phone = plusPhone(r.phone);
          if (!phone) return null;
          const names = namesFromRecipient(r);
          const row = {
            phone,
            name: r.name || names.join(" + ") || "",
            names,
            code: String(r.code || "").trim(),
            state: "queued",
            channel: "none",
            detail: "Queued for sending",
            updatedAt: Date.now(),
            takenAt: null,
            takenAidId: "",
            printCount: 0,
            pickups: [],
          };
          ensurePickups(row);
          return row;
        })
        .filter(Boolean),
    };

    recountStats(newCampaign);
    campaigns = [newCampaign, ...campaigns.filter((c) => c.id !== newCampaign.id)];
    scheduleSave();
    ctx.io.emit("campaigns:data", { campaigns: list() });
    ctx.io.emit("campaigns:update", publicSummary(newCampaign));
    return newCampaign;
  }

  function updateRecipient(campaignId, { phone, state, channel, detail, sentNames }) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return;

    const formattedPhone = plusPhone(phone);
    if (!formattedPhone) return;
    let target = campaign.recipients.find((r) => r.phone === formattedPhone);
    if (!target) {
      target = {
        phone: formattedPhone,
        name: "",
        names: [],
        state: "pending",
        channel: "none",
        detail: "",
        updatedAt: Date.now(),
        takenAt: null,
        takenAidId: "",
        printCount: 0,
        pickups: [],
      };
      campaign.recipients.push(target);
      ensurePickups(target);
    }

    target.state = state || target.state;
    if (channel) target.channel = channel;
    if (detail) target.detail = detail;
    if (Array.isArray(sentNames)) {
      target.sentNames = sentNames.map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    }
    target.updatedAt = Date.now();
    recountStats(campaign);
    scheduleSave();
  }

  function interrupt(campaignId, reason, detail) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign || campaign.status === "completed") return campaign;
    campaign.status = "interrupted";
    campaign.pauseReason = reason || "whatsapp_disconnect";
    campaign.pausedAt = Date.now();
    for (const recipient of campaign.recipients || []) {
      if (recipient.state === "sending") {
        recipient.state = "retry";
        recipient.detail = detail || pauseCopy(campaign.pauseReason).detail;
        recipient.updatedAt = Date.now();
      }
    }
    recountStats(campaign);
    scheduleSave();
    ctx.io.emit("campaigns:update", publicSummary(campaign));
    ctx.io.emit("send:resumable", { campaigns: listResumable() });
    return campaign;
  }

  function markRunning(campaignId, senderPhone = "") {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return campaign;
    campaign.status = "running";
    campaign.pauseReason = null;
    campaign.pausedAt = null;
    campaign.completedAt = null;
    if (senderPhone) campaign.senderPhone = String(senderPhone);
    scheduleSave();
    ctx.io.emit("campaigns:update", publicSummary(campaign));
    return campaign;
  }

  function setSenderPhone(campaignId, senderPhone) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign || !senderPhone) return;
    campaign.senderPhone = String(senderPhone);
    scheduleSave();
  }

  function syncBatchStats(campaignId) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return;
    recountStats(campaign);
    scheduleSave();
    ctx.io.emit("campaigns:update", publicSummary(campaign));
  }

  async function finishCampaign(campaignId, { stopped = false, summary = null, interrupted = false, reason = null }) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return;
    recountStats(campaign);
    const remaining = remainingOf(campaign).length;
    if (interrupted || (stopped && remaining > 0)) {
      campaign.status = interrupted ? "interrupted" : "stopped";
      campaign.pauseReason = reason || (stopped ? "user_stop" : campaign.pauseReason);
      campaign.pausedAt = Date.now();
      campaign.completedAt = null;
    } else {
      campaign.status = "completed";
      campaign.pauseReason = null;
      campaign.completedAt = Date.now();
    }
    if (summary) {
      // Recipients are source of truth; still keep summary as fallback extras.
      recountStats(campaign);
    }
    scheduleSave();
    ctx.io.emit("campaigns:data", { campaigns: list() });
    ctx.io.emit("campaigns:update", publicSummary(campaign));
    ctx.io.emit("send:resumable", { campaigns: listResumable() });
  }

  async function deleteCampaign(campaignId) {
    campaigns = campaigns.filter((c) => c.id !== String(campaignId));
    scheduleSave();
    ctx.io.emit("campaigns:data", { campaigns: list() });
    ctx.io.emit("send:resumable", { campaigns: listResumable() });
  }

  function emit(socket) {
    const payload = { campaigns: list() };
    if (socket) socket.emit("campaigns:data", payload);
    else ctx.io.emit("campaigns:data", payload);
    const resumable = { campaigns: listResumable() };
    if (socket) socket.emit("send:resumable", resumable);
    else ctx.io.emit("send:resumable", resumable);
  }

  function matchesPickupPerson(campaign, recipient, pickup, query) {
    if (!query) return true;
    const q = normalizeSearch(query);
    if (!q) return true;
    if (matchesText(pickup.name, q)) return true;
    if (matchesText(recipient.name, q)) return true;
    if (matchesText(recipient.code, q)) return true;
    if (matchesText(pickup.takenAidId, q)) return true;
    if (matchesText(campaign.name, q)) return true;
    const digitsQuery = String(query).replace(/\D/g, "");
    if (digitsQuery.length >= 3) {
      const targetDigits = String(recipient.phone || "").replace(/\D/g, "");
      if (targetDigits.includes(digitsQuery)) return true;
      const aidDigits = String(pickup.takenAidId || "").replace(/\D/g, "");
      if (aidDigits.includes(digitsQuery)) return true;
      const codeDigits = String(recipient.code || "").replace(/\D/g, "");
      if (codeDigits.includes(digitsQuery)) return true;
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
    const code = normalizeSearch(recipient.code);
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

  function resolveDayFilter({ campaignDay, scope } = {}) {
    const raw = String(campaignDay || "").trim().toLowerCase();
    if (raw === "all") return "";
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 8) return digits;
    if (scope === "today") return campaignDayKey(Date.now());
    return "";
  }

  function searchPickup({
    query = "",
    scope,
    campaignDay,
    campaignId = "",
    status = "all",
    limit,
  } = {}) {
    const q = String(query || "").trim();
    const day = resolveDayFilter({ campaignDay, scope });
    const campId = String(campaignId || "").trim();
    const wantStatus = status === "pending" || status === "taken" ? status : "all";
    const maxItems = Math.min(Math.max(Number(limit) || (wantStatus === "taken" ? 2000 : PICKUP_RESULT_LIMIT), 1), 5000);
    const items = [];

    for (const campaign of campaigns) {
      if (campId && campaign.id !== campId) continue;
      if (day && campaignDayKey(campaign.createdAt) !== day) continue;
      for (const recipient of campaign.recipients || []) {
        for (const pickup of ensurePickups(recipient)) {
          const taken = Boolean(pickup.takenAt);
          if (wantStatus === "pending" && taken) continue;
          if (wantStatus === "taken" && !taken) continue;
          if (q && !matchesPickupPerson(campaign, recipient, pickup, q)) continue;
          items.push({
            ...publicPickup(campaign, recipient, pickup),
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

  function markTaken(campaignId, phone, personName) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return { ok: false, error: "Campaign not found." };
    const target = findRecipient(campaign, phone);
    if (!target) return { ok: false, error: "Person not found in this campaign." };
    const pickup = findPickup(target, personName);
    if (!pickup) {
      return {
        ok: false,
        error: "Choose which family member is collecting. Each person gets their own bill.",
      };
    }

    if (pickup.takenAt) {
      return {
        ok: true,
        alreadyTaken: true,
        reprint: false,
        receipt: buildReceipt(campaign, target, pickup, { reprint: true }),
        recipient: publicPickup(campaign, target, pickup),
      };
    }

    if (!pickup.takenAidId) {
      pickup.takenAidId = allocateAidId(campaign);
    }
    pickup.takenAt = Date.now();
    pickup.printCount = (Number(pickup.printCount) || 0) + 1;
    target.updatedAt = Date.now();
    ensurePickups(target);
    recountStats(campaign);
    scheduleSave();
    emitRecipient(campaign, target, pickup);
    return {
      ok: true,
      alreadyTaken: false,
      reprint: false,
      receipt: buildReceipt(campaign, target, pickup, { reprint: false }),
      recipient: publicPickup(campaign, target, pickup),
    };
  }

  function reprintTaken(campaignId, phone, personName) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return { ok: false, error: "Campaign not found." };
    const target = findRecipient(campaign, phone);
    if (!target) return { ok: false, error: "Person not found in this campaign." };
    const pickup = findPickup(target, personName);
    if (!pickup) return { ok: false, error: "Choose which family member to reprint." };
    if (!pickup.takenAt || !pickup.takenAidId) {
      return { ok: false, error: "This person has not collected aid yet." };
    }
    pickup.printCount = (Number(pickup.printCount) || 1) + 1;
    target.updatedAt = Date.now();
    ensurePickups(target);
    scheduleSave();
    emitRecipient(campaign, target, pickup);
    return {
      ok: true,
      alreadyTaken: true,
      reprint: true,
      receipt: buildReceipt(campaign, target, pickup, { reprint: true }),
      recipient: publicPickup(campaign, target, pickup),
    };
  }

  function undoTaken(campaignId, phone, personName) {
    const campaign = campaigns.find((c) => c.id === String(campaignId));
    if (!campaign) return { ok: false, error: "Campaign not found." };
    const target = findRecipient(campaign, phone);
    if (!target) return { ok: false, error: "Person not found in this campaign." };
    const pickup = findPickup(target, personName);
    if (!pickup) return { ok: false, error: "Choose which family member to undo." };
    if (!pickup.takenAt) return { ok: false, error: "This person is not marked as collected." };
    pickup.takenAt = null;
    target.updatedAt = Date.now();
    ensurePickups(target);
    recountStats(campaign);
    scheduleSave();
    emitRecipient(campaign, target, pickup);
    return {
      ok: true,
      undone: true,
      recipient: publicPickup(campaign, target, pickup),
    };
  }

  return {
    list,
    listResumable,
    get,
    create,
    updateRecipient,
    interrupt,
    markRunning,
    setSenderPhone,
    remainingRecipients,
    remainingCount,
    syncBatchStats,
    finishCampaign,
    delete: deleteCampaign,
    emit,
    searchPickup,
    markTaken,
    reprintTaken,
    undoTaken,
  };
}
