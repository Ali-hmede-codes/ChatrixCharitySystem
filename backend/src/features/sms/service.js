import { delay } from "../../shared/delay.js";
import { createJsonStore } from "../../infrastructure/json-file.js";
import { toWhatsAppDigits } from "../../shared/phone.js";
import { maskApiKey, normalizeFromNumber, sendSmsViaHttpSms } from "./gateway.js";

export function createSmsService(ctx) {
  const { SMS_SETTINGS_PATH, SMS_SEND_URL, SMS_GAP_MS } = ctx.config;
  const store = createJsonStore(SMS_SETTINGS_PATH, { enabled: false, apiKey: "", from: "" });
  const queue = [];
  let settings = { enabled: false, apiKey: "", from: "", deliveryWaitMinutes: 10, recallWindowMinutes: 15 };
  let busy = false;

  function clampMinutes(value) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 1) return 10;
    if (n > 120) return 120;
    return n;
  }

  // Recall (unsend) window for messages sent by a campaign. 0 disables recall
  // entirely. Capped at 180 minutes: WhatsApp only lets you revoke a message
  // for everyone within a short window, so longer values are pointless.
  function clampRecallMinutes(value) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 0) return 15;
    if (n > 180) return 180;
    return n;
  }

  function load() {
    const raw = store.read();
    settings = {
      enabled: Boolean(raw?.enabled),
      apiKey: String(raw?.apiKey || "").trim(),
      from: normalizeFromNumber(raw?.from),
      deliveryWaitMinutes: clampMinutes(raw?.deliveryWaitMinutes ?? 10),
      recallWindowMinutes: clampRecallMinutes(raw?.recallWindowMinutes ?? 15),
    };
    return settings;
  }

  async function write() {
    await store.write({
      enabled: Boolean(settings.enabled),
      apiKey: settings.apiKey,
      from: settings.from,
      deliveryWaitMinutes: settings.deliveryWaitMinutes,
      recallWindowMinutes: settings.recallWindowMinutes,
    });
  }

  function ready() {
    // SMS is Lebanon-only: the sender must be a +961 number.
    const fromDigits = toWhatsAppDigits(settings.from);
    return Boolean(
      settings.enabled && settings.apiKey && fromDigits && fromDigits.startsWith("961")
    );
  }

  function deliveryWaitMs() {
    return Math.max(1, Number(settings.deliveryWaitMinutes) || 10) * 60_000;
  }

  function recallWindowMs() {
    const n = Math.max(0, Number(settings.recallWindowMinutes) || 0);
    return n * 60_000;
  }

  function publicSettings() {
    return {
      enabled: Boolean(settings.enabled),
      hasApiKey: Boolean(settings.apiKey),
      from: settings.from || "",
      apiKeyMasked: maskApiKey(settings.apiKey),
      ready: ready(),
      deliveryWaitMinutes: Number(settings.deliveryWaitMinutes) || 10,
      recallWindowMinutes: Number(settings.recallWindowMinutes) || 0,
    };
  }

  function emit(socket) {
    const payload = publicSettings();
    if (socket) socket.emit("sms:settings", payload);
    else ctx.io.emit("sms:settings", payload);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        // Final pre-send check: if the caller passed a shouldSkip callback
        // (e.g. WhatsApp delivered the message while this SMS was waiting in
        // the queue), skip the send entirely instead of double-sending.
        if (job.shouldSkip && job.shouldSkip()) {
          job.resolve({ ok: false, reason: "delivered_on_whatsapp", skipped: true });
        } else {
          job.resolve(await job.task());
        }
      } catch (error) {
        job.resolve({ ok: false, reason: error.message || "SMS send failed" });
      }
      if (queue.length) await delay(SMS_GAP_MS);
    }
    busy = false;
  }

  function enqueue(task, shouldSkip) {
    return new Promise((resolve) => {
      queue.push({ task, resolve, shouldSkip });
      pump();
    });
  }

  async function send({ phone, text }) {
    if (!settings.enabled) return { ok: false, reason: "disabled", skipped: true };
    if (!settings.apiKey) return { ok: false, reason: "no_api_key", skipped: true };
    if (!settings.from) return { ok: false, reason: "no_from", skipped: true };
    // SMS fallback is Lebanon-only: Syrian (+963) recipients are skipped so
    // they never get an SMS (they stay WhatsApp-only).
    const digits = toWhatsAppDigits(phone);
    if (!digits || !digits.startsWith("961")) {
      return { ok: false, reason: "not_lebanese", skipped: true };
    }
    return sendSmsViaHttpSms({
      url: SMS_SEND_URL,
      apiKey: settings.apiKey,
      from: settings.from,
      phone,
      text,
    });
  }

  async function save(payload, socket) {
    const enabled = Boolean(payload?.enabled);
    const nextKey = String(payload?.apiKey || "").trim();
    const fromDigits = toWhatsAppDigits(payload?.from || settings.from);
    if (enabled && !nextKey && !settings.apiKey) {
      socket.emit("sms:error", "SMS is not configured. Paste the httpSMS API key first.");
      return;
    }
    if (enabled && !fromDigits) {
      socket.emit(
        "sms:error",
        "SMS is not configured. Enter a valid sender number in Lebanon (+961) format, for example +961 3 154 131."
      );
      return;
    }
    // SMS is Lebanon-only: a Syrian (+963) sender is not allowed.
    if (enabled && fromDigits && !fromDigits.startsWith("961")) {
      socket.emit(
        "sms:error",
        "SMS only supports Lebanese (+961) numbers. Enter a +961 sender number."
      );
      return;
    }
    settings = {
      enabled,
      apiKey: nextKey || settings.apiKey,
      from: fromDigits ? `+${fromDigits}` : "",
      deliveryWaitMinutes: clampMinutes(payload?.deliveryWaitMinutes ?? settings.deliveryWaitMinutes),
      recallWindowMinutes: clampRecallMinutes(payload?.recallWindowMinutes ?? settings.recallWindowMinutes),
    };
    try {
      await write();
      emit();
      socket.emit(
        "sms:saved",
        ready()
          ? `SMS fallback is on. Undelivered WhatsApp numbers will get the same message by SMS after ${settings.deliveryWaitMinutes} minutes.`
          : enabled
            ? "Saved, but SMS will not send until the API key and From number are set."
            : "SMS fallback is off."
      );
    } catch {
      socket.emit("sms:error", "Could not save SMS settings.");
    }
  }

  load();

  return {
    load,
    ready,
    publicSettings,
    emit,
    save,
    send,
    enqueue,
    isEnabled: () => Boolean(settings.enabled),
    deliveryWaitMs,
    recallWindowMs,
  };
}
