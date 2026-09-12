import { plusPhone, toWhatsAppDigits } from "../../shared/phone.js";

export async function sendSmsViaHttpSms({ url, apiKey, from, phone, text }) {
  const to = plusPhone(phone);
  const origin = plusPhone(from);
  const content = String(text || "").trim().slice(0, 1000);
  if (!to || !origin || !content) return { ok: false, reason: "invalid" };
  if (to === origin) return { ok: false, reason: "same_number" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ content, from: origin, to }),
      signal: AbortSignal.timeout(20_000),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = body?.message || body?.error || `HTTP ${response.status}`;
      return { ok: false, reason: String(message).slice(0, 180) };
    }
    return { ok: true, id: body?.data?.id || body?.id || null };
  } catch {
    return { ok: false, reason: "Could not reach httpSMS" };
  }
}

export function normalizeFromNumber(value) {
  const fromDigits = toWhatsAppDigits(value);
  return fromDigits ? `+${fromDigits}` : "";
}

export function maskApiKey(key) {
  const value = String(key || "");
  if (value.length < 8) return value ? "Saved" : "";
  return "••••" + value.slice(-4);
}
