const MAX_LENGTH = 160_000;
const MIN_LENGTH = 40;

export function sanitizeSignature(value) {
  const text = String(value || "").trim();
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return "";
  const match = text.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return "";
  const mime = match[1].toLowerCase() === "png" ? "png" : "jpeg";
  const b64 = match[2].replace(/\s+/g, "");
  if (b64.length < 32) return "";
  return `data:image/${mime};base64,${b64}`;
}

export function hasSignature(value) {
  return Boolean(sanitizeSignature(value));
}
