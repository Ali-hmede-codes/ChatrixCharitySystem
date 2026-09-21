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

export function pickupIsSigned(item) {
  return Boolean(item?.signed || hasSignature(item?.signature));
}

export function signatureImageParts(dataUrl) {
  const cleaned = sanitizeSignature(dataUrl);
  if (!cleaned) return null;
  const match = cleaned.match(/^data:image\/(png|jpeg);base64,(.+)$/i);
  if (!match) return null;
  return {
    extension: match[1].toLowerCase() === "png" ? "png" : "jpeg",
    base64: match[2],
  };
}

export function compressSignatureCanvas(canvas) {
  if (!canvas) return "";
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (!srcW || !srcH) return "";

  const MAX_W = 520;
  const MAX_H = 180;
  const scale = Math.min(MAX_W / srcW, MAX_H / srcH, 1);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);

  let dataUrl = "";
  try {
    dataUrl = out.toDataURL("image/jpeg", 0.58);
  } catch {
    return "";
  }
  return sanitizeSignature(dataUrl);
}
