import { sanitizeSignature } from "../../shared/signature.js";

const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const DEFAULT_SESSION_MS = 3 * 60 * 1000;

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

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function publicDevice(record, selfId) {
  return {
    deviceId: record.deviceId,
    name: record.name,
    kind: record.kind,
    self: record.deviceId === selfId,
  };
}

export function createSignDeviceService(ctx, { sessionMs = DEFAULT_SESSION_MS } = {}) {
  const devices = new Map();
  const bySocket = new Map();
  const sessions = new Map();
  const sessionByTarget = new Map();
  const sessionByOrigin = new Map();

  function socketById(id) {
    return ctx.io?.sockets?.sockets?.get(id) || null;
  }

  function emitTo(socketId, event, payload) {
    const socket = socketById(socketId);
    if (!socket) return;
    socket.emit(event, payload);
  }

  function broadcast() {
    for (const [socketId, deviceId] of bySocket) {
      emitTo(socketId, "sign-device:list", {
        devices: [...devices.values()].map((record) => publicDevice(record, deviceId)),
      });
    }
  }

  function clearSession(session, { reason, message, notifyOrigin = true, notifyTarget = true } = {}) {
    if (!session || !sessions.has(session.requestId)) return;
    sessions.delete(session.requestId);
    if (sessionByTarget.get(session.targetDeviceId) === session.requestId) {
      sessionByTarget.delete(session.targetDeviceId);
    }
    if (sessionByOrigin.get(session.originSocketId) === session.requestId) {
      sessionByOrigin.delete(session.originSocketId);
    }
    if (session.timer) clearTimeout(session.timer);
    const payload = { requestId: session.requestId, reason, message: message || "Signature request ended." };
    if (notifyOrigin) emitTo(session.originSocketId, "pickup:sign-cancelled", payload);
    if (notifyTarget) emitTo(session.targetSocketId, "pickup:sign-cancelled", payload);
  }

  function fail(socket, requestId, code, error) {
    socket.emit("pickup:sign-error", { requestId: requestId || "", code, error });
  }

  function hello(socket, payload) {
    const deviceId = cleanId(payload?.deviceId);
    const name = cleanName(payload?.name);
    const kind = cleanKind(payload?.kind);
    if (!deviceId || !name) {
      fail(socket, "", "invalid", "This device could not register for signing.");
      return;
    }

    const previous = devices.get(deviceId);
    if (previous && previous.socketId !== socket.id) {
      bySocket.delete(previous.socketId);
      emitTo(previous.socketId, "sign-device:replaced", {
        message: "Signing for this browser moved to the newest open tab.",
      });
      for (const session of [...sessions.values()]) {
        if (session.targetSocketId === previous.socketId) {
          clearSession(session, {
            reason: "disconnected",
            message: `${name} opened a new tab. Send the signature again.`,
            notifyTarget: false,
          });
        }
      }
    }

    const priorId = bySocket.get(socket.id);
    if (priorId && priorId !== deviceId) {
      const prior = devices.get(priorId);
      if (prior?.socketId === socket.id) devices.delete(priorId);
    }

    devices.set(deviceId, {
      deviceId,
      name,
      kind,
      socketId: socket.id,
      connectedAt: previous?.connectedAt || Date.now(),
    });
    bySocket.set(socket.id, deviceId);
    broadcast();
  }

  function rename(socket, payload) {
    const deviceId = bySocket.get(socket.id);
    const record = deviceId && devices.get(deviceId);
    if (!record || record.socketId !== socket.id) return;
    const name = cleanName(payload?.name);
    if (!name) return;
    record.name = name;
    for (const session of sessions.values()) {
      if (session.targetDeviceId === deviceId) session.targetName = name;
      if (session.originDeviceId === deviceId) session.originName = name;
    }
    broadcast();
  }

  function request(socket, payload) {
    const requestId = cleanId(payload?.requestId);
    const targetDeviceId = cleanId(payload?.targetDeviceId);
    const originDeviceId = bySocket.get(socket.id);
    if (!requestId || !targetDeviceId) {
      fail(socket, requestId, "invalid", "Could not start signing on that device.");
      return;
    }
    if (!originDeviceId) {
      fail(socket, requestId, "invalid", "This device is not registered yet. Refresh the page.");
      return;
    }
    if (targetDeviceId === originDeviceId) {
      fail(socket, requestId, "self", "That is this same device. Sign here instead.");
      return;
    }
    const target = devices.get(targetDeviceId);
    if (!target) {
      fail(socket, requestId, "offline", "That device is not connected to the site.");
      return;
    }
    if (sessionByTarget.has(targetDeviceId)) {
      fail(socket, requestId, "busy", `${target.name} is already signing for someone else.`);
      return;
    }
    if (sessionByOrigin.has(socket.id)) {
      fail(socket, requestId, "busy", "This desk is already waiting for a signature.");
      return;
    }

    const campaignId = clip(payload?.campaignId, 80);
    const phone = clip(payload?.phone, 40);
    const personName = clip(payload?.personName || payload?.name, 120);
    if (!campaignId || !phone || !personName) {
      fail(socket, requestId, "invalid", "Choose a person before sending the signature.");
      return;
    }

    const origin = devices.get(originDeviceId);
    const session = {
      requestId,
      originSocketId: socket.id,
      originDeviceId,
      originName: origin?.name || "Desk",
      targetSocketId: target.socketId,
      targetDeviceId,
      targetName: target.name,
      mode: payload?.mode === "reprint" ? "reprint" : "mark",
      person: {
        campaignId,
        phone,
        personName,
        name: clip(payload?.name || personName, 120),
        campaignName: clip(payload?.campaignName, 160),
        code: clip(payload?.code, 80),
      },
      createdAt: Date.now(),
      timer: null,
    };
    session.timer = setTimeout(() => {
      const current = sessions.get(requestId);
      if (!current) return;
      clearSession(current, {
        reason: "timeout",
        message: `No signature arrived from ${current.targetName}. The request expired.`,
      });
    }, sessionMs);
    session.timer.unref?.();

    sessions.set(requestId, session);
    sessionByTarget.set(targetDeviceId, requestId);
    sessionByOrigin.set(socket.id, requestId);

    emitTo(target.socketId, "pickup:sign-incoming", {
      requestId,
      fromName: session.originName,
      fromDeviceId: originDeviceId,
      mode: session.mode,
      person: session.person,
    });
    socket.emit("pickup:sign-waiting", {
      requestId,
      targetDeviceId,
      targetName: target.name,
    });
  }

  function submit(socket, payload) {
    const requestId = cleanId(payload?.requestId);
    const session = requestId && sessions.get(requestId);
    if (!session || session.targetSocketId !== socket.id) {
      fail(socket, requestId, "invalid", "That signature request is no longer active.");
      return;
    }
    const signature = sanitizeSignature(payload?.signature);
    if (!signature) {
      fail(socket, requestId, "invalid", "Draw the signature, then tap OK.");
      return;
    }
    if (!socketById(session.originSocketId)) {
      clearSession(session, {
        reason: "desk-disconnected",
        message: "The desk disconnected. The signature was not saved.",
        notifyOrigin: false,
        notifyTarget: true,
      });
      return;
    }

    const ready = {
      requestId,
      signature,
      targetName: session.targetName,
      mode: session.mode,
      person: session.person,
    };
    sessions.delete(requestId);
    if (sessionByTarget.get(session.targetDeviceId) === requestId) sessionByTarget.delete(session.targetDeviceId);
    if (sessionByOrigin.get(session.originSocketId) === requestId) sessionByOrigin.delete(session.originSocketId);
    if (session.timer) clearTimeout(session.timer);

    emitTo(session.originSocketId, "pickup:sign-ready", ready);
    socket.emit("pickup:sign-finished", { requestId, name: session.person.name });
  }

  function cancel(socket, payload) {
    const requestId = cleanId(payload?.requestId);
    const session = requestId && sessions.get(requestId);
    if (!session) return;
    const isOrigin = session.originSocketId === socket.id;
    const isTarget = session.targetSocketId === socket.id;
    if (!isOrigin && !isTarget) return;
    if (isOrigin) {
      clearSession(session, {
        reason: "cancelled",
        message: "The desk cancelled the signature.",
        notifyOrigin: false,
      });
      return;
    }
    clearSession(session, {
      reason: "declined",
      message: `${session.targetName} closed the signature without signing.`,
      notifyTarget: false,
    });
  }

  function onDisconnect(socket) {
    const deviceId = bySocket.get(socket.id);
    bySocket.delete(socket.id);
    if (deviceId) {
      const record = devices.get(deviceId);
      if (record?.socketId === socket.id) devices.delete(deviceId);
    }
    for (const session of [...sessions.values()]) {
      if (session.originSocketId === socket.id) {
        clearSession(session, {
          reason: "desk-disconnected",
          message: "The desk disconnected. The signature was not saved.",
          notifyOrigin: false,
        });
      } else if (session.targetSocketId === socket.id) {
        clearSession(session, {
          reason: "disconnected",
          message: `${session.targetName} disconnected before the signature was saved.`,
          notifyTarget: false,
        });
      }
    }
    broadcast();
  }

  return { hello, rename, request, submit, cancel, onDisconnect, broadcast };
}
