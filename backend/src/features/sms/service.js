import { delay } from "../../shared/delay.js";
import { createJsonStore } from "../../infrastructure/json-file.js";
import { toWhatsAppDigits } from "../../shared/phone.js";
import { maskApiKey, normalizeFromNumber, sendSmsViaHttpSms } from "./gateway.js";

export function createSmsService(ctx) {
  const { SMS_SETTINGS_PATH, SMS_SEND_URL, SMS_GAP_MS } = ctx.config;
  const store = createJsonStore(SMS_SETTINGS_PATH, { enabled: false, apiKey: "", from: "" });
  const queue = [];
  let settings = { enabled: false, apiKey: "", from: "" };
  let busy = false;

  function load() {
    const raw = store.read();
    settings = {
      enabled: Boolean(raw?.enabled),
      apiKey: String(raw?.apiKey || "").trim(),
      from: normalizeFromNumber(raw?.from),
    };
    return settings;
  }

  async function write() {
    await store.write({
      enabled: Boolean(settings.enabled),
      apiKey: settings.apiKey,
      from: settings.from,
    });
  }

  function ready() {
    return Boolean(settings.enabled && settings.apiKey && settings.from);
  }

  function publicSettings() {
    return {
      enabled: Boolean(settings.enabled),
      hasApiKey: Boolean(settings.apiKey),
      from: settings.from || "",
      apiKeyMasked: maskApiKey(settings.apiKey),
      ready: ready(),
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
        job.resolve(await job.task());
      } catch (error) {
        job.resolve({ ok: false, reason: error.message || "SMS send failed" });
      }
      if (queue.length) await delay(SMS_GAP_MS);
    }
    busy = false;
  }

  function enqueue(task) {
    return new Promise((resolve) => {
      queue.push({ task, resolve });
      pump();
    });
  }

  async function send({ phone, text }) {
    if (!settings.enabled) return { ok: false, reason: "disabled", skipped: true };
    if (!settings.apiKey) return { ok: false, reason: "no_api_key", skipped: true };
    if (!settings.from) return { ok: false, reason: "no_from", skipped: true };
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
      socket.emit("sms:error", "Paste the httpSMS API key first.");
      return;
    }
    if (enabled && !fromDigits) {
      socket.emit("sms:error", "Enter the Android From number in +961 or +963 format.");
      return;
    }
    settings = {
      enabled,
      apiKey: nextKey || settings.apiKey,
      from: fromDigits ? `+${fromDigits}` : "",
    };
    try {
      await write();
      emit();
      socket.emit(
        "sms:saved",
        ready()
          ? "SMS fallback is on. Undelivered WhatsApp numbers will get the same message by SMS."
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
  };
}
