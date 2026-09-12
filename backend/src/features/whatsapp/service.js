import QRCode from "qrcode";
import { WaClient } from "zapo-js";
import { delay, withTimeout } from "../../shared/delay.js";
import { displayPhone } from "../../shared/phone.js";
import { createWhatsAppDirectory } from "./lookup.js";
import {
  clearSessionForRelink,
  createWhatsAppStore,
  destroyWhatsAppStore,
  loadSessionId,
  loadWamPlugin,
  removeSqliteSessionFiles,
  rotateSessionId,
} from "./store.js";
import { zapoLogger } from "./zapo-logger.js";

function log(...args) {
  console.log("[whatsapp]", ...args);
}

export function createWhatsAppService(ctx) {
  const { config, logger } = ctx;
  let client = null;
  let store = null;
  let sessionId = loadSessionId(config);
  let starting = false;
  let loggingOut = false;
  let resetting = false;
  let resetPromise = null;
  let reconnectTimer = null;
  let qrWatchTimer = null;
  let qrWatchTries = 0;
  let qrDataUrl = null;
  let restoreAttempts = 0;
  const status = {
    state: "starting",
    phone: null,
    message: "Starting WhatsApp connection…",
  };

  const directory = createWhatsAppDirectory({
    getClient: () => client,
    getStore: () => store,
    getSessionId: () => sessionId,
  });

  function linkedLabel(credentials) {
    if (!credentials) return status.phone;
    return (
      displayPhone(credentials.meJid) ||
      displayPhone(credentials.meLid) ||
      credentials.meDisplayName ||
      status.phone ||
      "Linked"
    );
  }

  function clearQrWatch() {
    if (qrWatchTimer) {
      clearTimeout(qrWatchTimer);
      qrWatchTimer = null;
    }
  }

  function armQrWatch() {
    clearQrWatch();
    qrWatchTimer = setTimeout(() => {
      qrWatchTimer = null;
      if (qrDataUrl || status.state === "open" || loggingOut || resetting) return;
      qrWatchTries += 1;
      log("QR watchdog fired", { tries: qrWatchTries, state: status.state });
      if (qrWatchTries <= 1) {
        status.message = "WhatsApp did not send a QR. Clearing login and retrying…";
        ctx.broadcast();
        resetWhatsAppSession({ tryServerLogout: false }).catch((error) => {
          log("watchdog reset failed", error.message || error);
        });
        return;
      }
      starting = false;
      status.state = "error";
      status.message =
        "Could not get a QR from WhatsApp. Check internet, then click Clear session & auth.";
      ctx.broadcast();
    }, 12_000);
  }

  function scheduleReconnect(ms, reason) {
    if (loggingOut || resetting || reconnectTimer || starting) {
      log("reconnect skipped", { reason, loggingOut, resetting, starting, hasTimer: Boolean(reconnectTimer) });
      return;
    }
    status.state = "reconnecting";
    status.message = "Keeping the link…";
    qrDataUrl = null;
    ctx.broadcast();
    log(`reconnect in ${ms}ms (${reason})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startWhatsApp();
    }, ms);
  }

  function wireClient(next) {
    next.on("auth_qr", async ({ qr }) => {
      if (next !== client || loggingOut || resetting) return;
      starting = false;
      restoreAttempts = 0;
      qrWatchTries = 0;
      clearQrWatch();
      try {
        qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      } catch (error) {
        log("QR image encode failed", error.message || error);
        qrDataUrl = null;
      }
      status.state = "qr";
      status.phone = null;
      status.message = "Scan the QR code with the charity WhatsApp.";
      log("QR ready — WhatsApp → Linked devices → Link a device");
      ctx.broadcast();
    });

    next.on("auth_pairing_required", ({ forceManual }) => {
      if (next !== client || loggingOut || resetting) return;
      log("pairing required", { forceManual });
      if (forceManual) {
        starting = false;
        clearQrWatch();
        status.state = "error";
        status.message = "QR expired. Click Clear session & auth to get a new one.";
        ctx.broadcast();
      }
    });

    next.on("auth_paired", ({ credentials }) => {
      if (next !== client || loggingOut) return;
      status.phone = linkedLabel(credentials);
      status.message = `Paired as ${status.phone}`;
      log("paired", status.phone);
      ctx.broadcast();
    });

    next.on("debug_client_error", (event) => {
      const message = event?.error?.message || String(event?.error || "unknown");
      log("client error", message);
      if (next !== client || loggingOut || resetting) return;
      if (!qrDataUrl && status.state !== "open") {
        status.message = `WhatsApp error: ${message}`;
        ctx.broadcast();
      }
    });

    next.on("connection", (event) => {
      if (next !== client) return;

      if (event.status === "connecting") {
        status.message = "Talking to WhatsApp…";
        ctx.broadcast();
        return;
      }

      if (event.status === "open") {
        if (loggingOut || resetting) return;
        starting = false;
        restoreAttempts = 0;
        qrWatchTries = 0;
        clearQrWatch();
        qrDataUrl = null;
        status.state = "open";
        const credentials = next.getCredentials?.() || next.auth?.getCurrentCredentials?.();
        status.phone = linkedLabel(credentials) || status.phone || "Linked";
        status.message = `Connected as ${status.phone}`;
        log(status.message);
        ctx.broadcast();
        ctx.events.emit("whatsapp:open");
        return;
      }

      if (event.status !== "close") return;
      starting = false;
      const reason = event.reason || "closed";
      const code = event.code;
      log("closed", reason, code ?? "");

      if (loggingOut || resetting) return;

      if (event.isLogout || config.FATAL_REASONS.has(reason) || code === 401 || code === 403 || code === 406) {
        clearQrWatch();
        status.state = code === 402 || code === 406 || reason === "failure_banned" ? "error" : "logged-out";
        status.phone = null;
        qrDataUrl = null;
        status.message =
          code === 402 || code === 406 || reason === "failure_banned"
            ? "WhatsApp blocked this session. Stop sending and wait before linking again."
            : "Disconnected. Clear the saved session, then scan a new QR code.";
        ctx.broadcast();
        ctx.events.emit("whatsapp:closed", { reason, code, fatal: true });
        return;
      }

      if (reason === "client_disconnected") {
        const wasOpen = status.state === "open";
        status.state = wasOpen ? "reconnecting" : "logged-out";
        status.message = wasOpen
          ? "WhatsApp dropped. Reconnecting…"
          : "Disconnected. Generating a fresh QR…";
        ctx.broadcast();
        ctx.events.emit("whatsapp:closed", { reason, code, fatal: false });
        scheduleReconnect(1500, reason);
        return;
      }
      ctx.events.emit("whatsapp:closed", { reason, code, fatal: false });
      scheduleReconnect(reason === "stream_error_force_login" ? 400 : 2000, reason);
    });

    next.on("receipt", (event) => {
      try {
        ctx.events.emit("whatsapp:receipt", event);
      } catch (error) {
        logger.warn({ err: error }, "delivery receipt handling failed");
      }
    });
  }

  async function dropClient({ keepStarting = false } = {}) {
    const current = client;
    client = null;
    if (!keepStarting) starting = false;
    if (!current) return;
    try {
      await withTimeout(current.disconnect(), 4000, "disconnect timeout");
    } catch {
      // Ignore.
    }
  }

  async function startWhatsApp({ allowRestore = true } = {}) {
    if (loggingOut || resetting || starting) {
      log("start skipped", { loggingOut, resetting, starting });
      return;
    }
    starting = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    qrDataUrl = null;
    if (status.state !== "open") {
      status.state = "starting";
      status.message = allowRestore ? "Starting WhatsApp connection…" : "Generating a new QR code…";
    } else {
      status.message = "Refreshing WhatsApp link…";
    }
    ctx.broadcast();
    log("start", { allowRestore, sessionId });

    try {
      if (!store) {
        store = await createWhatsAppStore({ config, logger });
      }

      if (client) {
        if (status.state === "open") {
          try {
            await client.connect();
            return;
          } catch (error) {
            log("reconnect on existing client failed", error.message || error);
            await dropClient({ keepStarting: true });
          }
        } else {
          await dropClient({ keepStarting: true });
        }
      }

      let creds = null;
      if (allowRestore) {
        creds = await store.session(sessionId).auth.load().catch(() => null);
      }
      const registered = Boolean(creds?.meJid);
      log("credentials", { hasCreds: Boolean(creds), registered, sessionId });

      const plugins = await loadWamPlugin(logger);
      const next = new WaClient(
        {
          store,
          sessionId,
          connectTimeoutMs: 60_000,
          markOnlineOnConnect: false,
          recoverFromClientTooOld: true,
          deviceBrowser: "chrome",
          history: { enabled: false },
          plugins,
        },
        zapoLogger(logger)
      );
      client = next;
      wireClient(next);

      if (registered) {
        try {
          await withTimeout(next.connect(), 20_000, "restore timeout");
        } catch (error) {
          log("saved session did not reconnect", error.message || error);
          await dropClient({ keepStarting: true });
          restoreAttempts += 1;
          if (restoreAttempts <= 1) {
            starting = false;
            status.state = "starting";
            status.message = "Saved login is stale. Generating a new QR code…";
            ctx.broadcast();
            await resetWhatsAppSession({ tryServerLogout: false });
            return;
          }
          throw error;
        }
      } else {
        armQrWatch();
        next.connect().catch((error) => {
          if (client !== next || loggingOut || resetting) return;
          starting = false;
          clearQrWatch();
          log("QR connect failed", error.message || error);
          status.state = "error";
          status.message = error.message || "Could not start WhatsApp. Clear the session and try again.";
          ctx.broadcast();
          scheduleReconnect(4000, "qr start failed");
        });
      }
    } catch (error) {
      starting = false;
      clearQrWatch();
      log("start failed", error.message || error);
      status.state = "error";
      status.message = error.message || "Could not start WhatsApp. Clear the session and try again.";
      ctx.broadcast();
      scheduleReconnect(4000, "start failed");
    }
  }

  async function resetWhatsAppSession({ tryServerLogout = false } = {}) {
    if (resetPromise) return resetPromise;
    resetPromise = (async () => {
      resetting = true;
      loggingOut = true;
      starting = false;
      ctx.services.send?.pause?.("session_replaced");
      clearQrWatch();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      status.state = "starting";
      status.phone = null;
      qrDataUrl = null;
      status.message = "Clearing saved WhatsApp session…";
      ctx.broadcast();
      log("reset start", { sessionId, tryServerLogout });

      const current = client;
      client = null;

      try {
        if (tryServerLogout && current) {
          await withTimeout(current.logout(), 5000, "logout timeout");
        }
      } catch (error) {
        log("server logout skipped", error.message || error);
      }
      try {
        if (current) await withTimeout(current.disconnect(), 4000, "disconnect timeout");
      } catch {
        // Ignore.
      }

      await clearSessionForRelink(store, sessionId, logger);
      await destroyWhatsAppStore(store, logger);
      store = null;
      await delay(250);
      await removeSqliteSessionFiles(config, logger);
      sessionId = await rotateSessionId(config);
      restoreAttempts = 0;
      qrWatchTries = 0;

      status.state = "starting";
      status.phone = null;
      qrDataUrl = null;
      status.message = "Session cleared. Generating a new QR code…";
      ctx.broadcast();
      ctx.io.emit("wa:reset:done");
      log("reset done, new session", sessionId);

      loggingOut = false;
      resetting = false;
      store = await createWhatsAppStore({ config, logger });
      await startWhatsApp({ allowRestore: false });
    })()
      .catch((error) => {
        log("reset failed", error.message || error);
        status.state = "error";
        status.message = error.message || "Could not clear the WhatsApp session.";
        ctx.broadcast();
        ctx.io.emit("wa:reset:error", status.message);
        throw error;
      })
      .finally(() => {
        loggingOut = false;
        resetting = false;
        resetPromise = null;
      });
    return resetPromise;
  }

  async function logoutWhatsApp() {
    return resetWhatsAppSession({ tryServerLogout: status.state === "open" });
  }

  async function shutdown() {
    clearQrWatch();
    try {
      if (client) await client.disconnect();
    } catch {
      // Ignore.
    }
  }

  return {
    getClient: () => client,
    getStore: () => store,
    getStatus: () => ({ ...status }),
    getQr: () => qrDataUrl,
    isOpen: () => status.state === "open" && Boolean(client),
    start: startWhatsApp,
    logout: logoutWhatsApp,
    resetSession: resetWhatsAppSession,
    shutdown,
    lookupNumbers: directory.lookupWhatsAppNumbers,
    findStoredContact: directory.findStoredContact,
    resolveTarget: directory.resolveTarget,
  };
}
