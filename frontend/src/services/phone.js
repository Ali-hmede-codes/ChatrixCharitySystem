export function toAsciiDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

export function toDigits(phone) {
  return toAsciiDigits(phone).replace(/\D/g, "");
}

export function toWhatsAppDigits(raw) {
  let digits = toDigits(raw);
  if (!digits || /^0+$/.test(digits)) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("963")) {
    let national = digits.slice(3);
    if (national.startsWith("0")) national = national.slice(1);
    if (national.length < 8 || national.length > 10) return null;
    return `963${national}`;
  }

  if (digits.startsWith("961")) {
    let national = digits.slice(3);
    if (national.startsWith("0")) national = national.slice(1);
    if (national.length < 7 || national.length > 8) return null;
    return `961${national}`;
  }

  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    if (digits.startsWith("09") || rest.length === 9) {
      if (rest.length < 8 || rest.length > 10) return null;
      return `963${rest}`;
    }
    if (rest.length < 7 || rest.length > 8) return null;
    return `961${rest}`;
  }

  if (digits.length === 9 && digits.startsWith("9")) return `963${digits}`;
  if (digits.length === 7 || digits.length === 8) return `961${digits}`;
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
  const digits = toWhatsAppDigits(phone) || toDigits(phone);
  return digits ? `+${digits}` : String(phone || "");
}
