export function toDigits(phone) {
  return String(phone ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[\u200e\u200f\u202a-\u202e\u00a0]/g, " ")
    .replace(/(\d)\.0+\b/g, "$1")
    .replace(/\D/g, "");
}

function preprocessPhoneText(value) {
  let text = String(value ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[\u200e\u200f\u202a-\u202e\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && Math.abs(n) < 1e16) text = String(Math.trunc(Math.abs(n)));
  }

  return text.replace(/(\d)\.0+\b/g, "$1");
}

function normalizeCountryDigits(digits) {
  let value = String(digits || "");
  if (!value || /^0+$/.test(value)) return null;
  while (value.startsWith("00")) value = value.slice(2);

  if (value.startsWith("963")) {
    let national = value.slice(3);
    if (national.startsWith("0")) national = national.slice(1);
    if (national.length < 8 || national.length > 10) return null;
    return `963${national}`;
  }

  if (value.startsWith("961")) {
    let national = value.slice(3);
    if (national.startsWith("0")) national = national.slice(1);
    if (national.length < 7 || national.length > 8) return null;
    return `961${national}`;
  }

  if (value.startsWith("0")) {
    const rest = value.slice(1);
    if (value.startsWith("09") || rest.length === 9) {
      if (rest.length < 8 || rest.length > 10) return null;
      return `963${rest}`;
    }
    if (rest.length < 7 || rest.length > 8) return null;
    return `961${rest}`;
  }

  if (value.length === 9 && value.startsWith("9")) return `963${value}`;
  if (value.length === 7 || value.length === 8) return `961${value}`;
  return null;
}

function candidateDigitStrings(raw) {
  const text = preprocessPhoneText(raw);
  const candidates = [];
  const push = (value) => {
    const next = String(value || "").replace(/\D/g, "");
    if (next && !candidates.includes(next)) candidates.push(next);
  };

  push(text);

  const countryRe = /(?:\+|00)?(?:963|961)[\s\-./()]*\d[\d\s\-./()]{5,16}/g;
  for (const match of text.matchAll(countryRe)) push(match[0]);

  const runRe = /\d[\d\s\-./()]{5,14}\d/g;
  for (const match of text.matchAll(runRe)) push(match[0]);

  return candidates;
}

export function toWhatsAppDigits(phone) {
  if (phone == null || phone === "") return null;
  for (const digits of candidateDigitStrings(phone)) {
    const normalized = normalizeCountryDigits(digits);
    if (normalized) return normalized;
  }
  return null;
}

export function plusPhone(phone) {
  const digits = toWhatsAppDigits(phone);
  return digits ? `+${digits}` : "";
}

export function displayPhone(jid) {
  if (!jid) return null;
  const user = String(jid).split("@")[0].split(":")[0];
  const digits = user.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
