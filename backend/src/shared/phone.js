export function toDigits(phone) {
  return String(phone)
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/\D/g, "");
}

export function toWhatsAppDigits(phone) {
  let digits = toDigits(phone);
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

export function plusPhone(phone) {
  const digits = toWhatsAppDigits(phone) || toDigits(phone);
  return digits ? `+${digits}` : String(phone);
}

export function displayPhone(jid) {
  if (!jid) return null;
  const user = String(jid).split("@")[0].split(":")[0];
  const digits = user.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
