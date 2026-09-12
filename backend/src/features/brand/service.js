import { existsSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";

export function createBrandService(ctx) {
  const { LOGO_PATH, LOGO_META_PATH, LOGO_MIMES, LOGO_MAX_BYTES, AUTH_DIR } = ctx.config;

  function loadLogoMeta() {
    try {
      const raw = JSON.parse(readFileSync(LOGO_META_PATH, "utf8"));
      const mime = String(raw?.mime || "");
      if (!LOGO_MIMES.has(mime) || !existsSync(LOGO_PATH)) return null;
      return {
        mime,
        updatedAt: Number(raw?.updatedAt) || Date.now(),
      };
    } catch {
      return null;
    }
  }

  function publicBrand() {
    const meta = loadLogoMeta();
    return {
      hasLogo: Boolean(meta),
      url: meta ? "/logo?t=" + meta.updatedAt : "",
    };
  }

  function emitBrand(socket) {
    const payload = publicBrand();
    if (socket) socket.emit("brand:data", payload);
    else ctx.io.emit("brand:data", payload);
  }

  function serveLogo(_req, res) {
    const meta = loadLogoMeta();
    if (!meta || !existsSync(LOGO_PATH)) {
      res.status(404).end();
      return;
    }
    const body = readFileSync(LOGO_PATH);
    const type = meta.mime === "image/svg+xml" ? "image/svg+xml; charset=utf-8" : meta.mime;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  }

  async function saveLogo({ mime, data }, socket) {
    const type = String(mime || "");
    const encoded = String(data || "").replace(/\s/g, "");
    if (!LOGO_MIMES.has(type) || !encoded) {
      socket.emit("logo:error", "Use a PNG, JPG, WEBP, GIF, or SVG image.");
      return;
    }
    let buffer;
    try {
      buffer = Buffer.from(encoded, "base64");
    } catch {
      socket.emit("logo:error", "Could not read that image.");
      return;
    }
    if (!buffer.length || buffer.length > LOGO_MAX_BYTES) {
      socket.emit("logo:error", "Logo must be an image under 1.5 MB.");
      return;
    }
    try {
      await mkdir(AUTH_DIR, { recursive: true });
      await writeFile(LOGO_PATH, buffer);
      await writeFile(LOGO_META_PATH, JSON.stringify({ mime: type, updatedAt: Date.now() }, null, 2), "utf8");
      emitBrand();
      socket.emit("logo:saved", "Logo saved. It now replaces the circle in the top bar.");
    } catch {
      socket.emit("logo:error", "Could not save the logo.");
    }
  }

  async function clearLogo(socket) {
    try {
      await unlink(LOGO_PATH);
    } catch {
      // Ignore missing file.
    }
    try {
      await unlink(LOGO_META_PATH);
    } catch {
      // Ignore missing file.
    }
    emitBrand();
    socket.emit("logo:saved", "Logo removed. The default C circle is back.");
  }

  return { loadLogoMeta, publicBrand, emitBrand, serveLogo, saveLogo, clearLogo };
}
