import { createJsonStore } from "../../infrastructure/json-file.js";

const MAX_SAVED_CAMPAIGNS = 60;

export function createCampaignRepository(ctx) {
  const { CAMPAIGNS_PATH, AID_SEQ_PATH } = ctx.config;
  const store = createJsonStore(CAMPAIGNS_PATH, []);
  const seqStore = createJsonStore(AID_SEQ_PATH, {});

  function load() {
    const raw = store.read();
    const list = Array.isArray(raw) ? raw : [];
    return list.map(sanitizeCampaign).filter(Boolean);
  }

  async function write(list) {
    const capped = list.slice(0, MAX_SAVED_CAMPAIGNS);
    await store.write(capped);
  }

  function sanitizeRecipient(r) {
    if (!r) return null;
    const names = Array.isArray(r.names)
      ? r.names.map((name) => String(name || "").trim()).filter(Boolean)
      : [];
    return {
      phone: String(r.phone || ""),
      name: String(r.name || names.join(" + ") || ""),
      names,
      code: String(r.code || "").trim(),
      state: String(r.state || "queued"),
      channel: String(r.channel || "none"),
      detail: String(r.detail || ""),
      updatedAt: Number(r.updatedAt) || Date.now(),
      takenAt: r.takenAt ? Number(r.takenAt) : null,
      takenAidId: String(r.takenAidId || "").trim(),
      printCount: Number(r.printCount) || 0,
      sentNames: Array.isArray(r.sentNames)
        ? r.sentNames.map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean)
        : [],
      pickups: Array.isArray(r.pickups)
        ? r.pickups
            .map((p) => {
              if (!p) return null;
              const name = String(p.name || "").replace(/\s+/g, " ").trim();
              if (!name) return null;
              return {
                name,
                takenAt: p.takenAt ? Number(p.takenAt) : null,
                takenAidId: String(p.takenAidId || "").trim(),
                printCount: Number(p.printCount) || 0,
              };
            })
            .filter(Boolean)
            .slice(0, 20)
        : [],
    };
  }

  function sanitizeCampaign(c) {
    if (!c || !c.id) return null;
    return {
      id: String(c.id),
      name: String(c.name || "Untitled Campaign"),
      createdAt: Number(c.createdAt) || Date.now(),
      completedAt: c.completedAt ? Number(c.completedAt) : null,
      pausedAt: c.pausedAt ? Number(c.pausedAt) : null,
      status: String(c.status || "completed"),
      pauseReason: String(c.pauseReason || "") || null,
      enableSms: Boolean(c.enableSms),
      message: String(c.message || ""),
      aidCode: String(c.aidCode || ""),
      senderPhone: String(c.senderPhone || ""),
      sendOptions: {
        message: String(c.sendOptions?.message || c.message || ""),
        useNameTemplate: Boolean(c.sendOptions?.useNameTemplate),
        nameTemplate: String(c.sendOptions?.nameTemplate || ""),
        enableSms: c.sendOptions?.enableSms !== undefined ? Boolean(c.sendOptions.enableSms) : Boolean(c.enableSms),
      },
      totalRecipients: Number(c.totalRecipients) || 0,
      stats: {
        sent: Number(c.stats?.sent) || 0,
        delivered: Number(c.stats?.delivered) || 0,
        waiting: Number(c.stats?.waiting) || 0,
        undelivered: Number(c.stats?.undelivered) || 0,
        smsSent: Number(c.stats?.smsSent) || 0,
        smsFailed: Number(c.stats?.smsFailed) || 0,
        failed: Number(c.stats?.failed) || 0,
        skipped: Number(c.stats?.skipped) || 0,
        taken: Number(c.stats?.taken) || 0,
        people: Number(c.stats?.people) || 0,
      },
      recipients: Array.isArray(c.recipients)
        ? c.recipients.map(sanitizeRecipient).filter(Boolean).slice(0, 400)
        : [],
    };
  }

  function loadSeq() {
    const raw = seqStore.read();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const next = {};
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value);
      if (/^\d{8}$/.test(key) && Number.isFinite(n) && n > 0) next[key] = Math.floor(n);
    }
    return next;
  }

  async function writeSeq(map) {
    await seqStore.write(map && typeof map === "object" ? map : {});
  }

  return {
    load,
    write,
    loadSeq,
    writeSeq,
    sanitizeCampaign,
  };
}
