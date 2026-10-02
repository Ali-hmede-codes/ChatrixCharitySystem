const ID_KEY = "ziko.signDevice.id";
const NAME_KEY = "ziko.signDevice.name";
const TARGET_KEY = "ziko.signDevice.target";
const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const memory = new Map();

function storageGet(key) {
  try {
    const value = localStorage.getItem(key);
    if (value != null) return value;
  } catch {
    // Private mode can block storage; the in-memory copy covers this tab.
  }
  return memory.has(key) ? memory.get(key) : null;
}

function storageSet(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // The in-memory copy still identifies this tab until reload.
  }
}

export function createSignRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cleanId(value) {
  const text = String(value || "").trim();
  return ID_RE.test(text) ? text : "";
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function cleanKind(value) {
  const text = String(value || "");
  if (text === "phone" || text === "tablet" || text === "computer") return text;
  return "computer";
}

export function kindLabel(kind) {
  if (kind === "phone") return "Phone";
  if (kind === "tablet") return "Tablet";
  return "Computer";
}

function detectKind() {
  if (typeof navigator === "undefined") return "computer";
  const ua = navigator.userAgent || "";
  const mobileHint = navigator.userAgentData?.mobile === true;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return "tablet";
  }
  if (mobileHint || /Mobi|Android|iPhone|iPod/i.test(ua)) return "phone";
  return "computer";
}

export function readLocalSignDevice() {
  let deviceId = cleanId(storageGet(ID_KEY));
  if (!deviceId) {
    deviceId = createSignRequestId();
    storageSet(ID_KEY, deviceId);
  }
  const kind = detectKind();
  let name = cleanName(storageGet(NAME_KEY));
  if (!name) {
    name = kindLabel(kind);
    storageSet(NAME_KEY, name);
  }
  return { deviceId, name, kind };
}

export function writeLocalSignDeviceName(name) {
  const cleaned = cleanName(name);
  if (!cleaned) return "";
  storageSet(NAME_KEY, cleaned);
  return cleaned;
}

export function readSignTarget() {
  try {
    const raw = JSON.parse(storageGet(TARGET_KEY) || "");
    const id = raw?.id === "self" ? "self" : cleanId(raw?.id);
    if (!id || id === "self") return { id: "self", name: "", kind: "computer" };
    return {
      id,
      name: cleanName(raw?.name) || "Other device",
      kind: cleanKind(raw?.kind),
    };
  } catch {
    return { id: "self", name: "", kind: "computer" };
  }
}

export function writeSignTarget(target) {
  const id = target?.id === "self" ? "self" : cleanId(target?.id);
  const next =
    id && id !== "self"
      ? {
          id,
          name: cleanName(target?.name) || "Other device",
          kind: cleanKind(target?.kind),
        }
      : { id: "self", name: "", kind: cleanKind(target?.kind) };
  storageSet(TARGET_KEY, JSON.stringify(next));
  return next;
}

export function describeSignTarget({ target, self, devices, socketConnected }) {
  const selfId = self?.deviceId || "";
  const remote = Boolean(target?.id && target.id !== "self" && target.id !== selfId);
  if (!remote) {
    const kind = self?.kind || "computer";
    return {
      where: "self",
      name: self?.name || kindLabel(kind),
      kind,
      online: true,
      deviceId: selfId,
      label: `This ${kindLabel(kind).toLowerCase()}`,
    };
  }
  const live = (devices || []).find((device) => device.deviceId === target.id && !device.self);
  const name = live?.name || target.name || "Other device";
  const kind = live?.kind || target.kind || "phone";
  return {
    where: "remote",
    name,
    kind,
    online: Boolean(live) && Boolean(socketConnected),
    deviceId: target.id,
    label: name,
  };
}

export function deviceListLabel(device, { online, duplicate }) {
  const kind = kindLabel(device?.kind);
  const name = device?.name || kind;
  const same = name.toLowerCase() === kind.toLowerCase();
  const idBit = duplicate ? ` ${String(device.deviceId || "").slice(-4)}` : "";
  const who = same ? `${kind}${idBit}` : `${name}${idBit} · ${kind}`;
  return `${who} · ${online ? "online" : "offline"}`;
}
