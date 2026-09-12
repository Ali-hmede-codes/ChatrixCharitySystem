export function toAsciiDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

function preprocessPhoneText(value) {
  let text = toAsciiDigits(value)
    .replace(/[\u200e\u200f\u202a-\u202e\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && Math.abs(n) < 1e16) text = String(Math.trunc(Math.abs(n)));
  }

  return text.replace(/(\d)\.0+\b/g, "$1");
}

export function toDigits(phone) {
  return preprocessPhoneText(phone).replace(/\D/g, "");
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
    const digits = String(value || "").replace(/\D/g, "");
    if (digits && !candidates.includes(digits)) candidates.push(digits);
  };

  push(text);

  const countryRe = /(?:\+|00)?(?:963|961)[\s\-./()]*\d[\d\s\-./()]{5,16}/g;
  for (const match of text.matchAll(countryRe)) push(match[0]);

  const runRe = /\d[\d\s\-./()]{5,14}\d/g;
  for (const match of text.matchAll(runRe)) push(match[0]);

  return candidates;
}

export function toWhatsAppDigits(raw) {
  if (raw == null || raw === "") return null;
  for (const digits of candidateDigitStrings(raw)) {
    const normalized = normalizeCountryDigits(digits);
    if (normalized) return normalized;
  }
  return null;
}

export function formatPhone(digits) {
  const value = String(digits || "");
  if (value.startsWith("963")) {
    const national = value.slice(3);
    if (national.length === 9) {
      return `+963 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
    }
    return `+963 ${national}`;
  }
  const national = value.replace(/^961/, "");
  if (national.length === 8) {
    return `+961 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  if (national.length === 7) {
    return `+961 ${national.slice(0, 1)} ${national.slice(1, 4)} ${national.slice(4)}`;
  }
  return `+961 ${national}`;
}

export function normalizePhone(raw) {
  const digits = toWhatsAppDigits(raw);
  return digits ? formatPhone(digits) : null;
}

export function phoneKey(phone) {
  return toWhatsAppDigits(phone) || "";
}

export function plusPhone(phone) {
  const digits = toWhatsAppDigits(phone);
  return digits ? `+${digits}` : "";
}

export function describePhoneIssue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (toWhatsAppDigits(trimmed)) return "";
  const digits = toDigits(trimmed);
  if (!digits) return "No phone digits found";
  if (digits.startsWith("963") || digits.startsWith("961") || digits.startsWith("09") || digits.startsWith("0")) {
    return "Wrong length for Lebanon (+961) or Syria (+963)";
  }
  return "Must be a Lebanon (+961) or Syria (+963) number";
}
