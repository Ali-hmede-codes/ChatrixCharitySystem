import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStore } from "zapo-js";
import { createSqliteStore } from "@zapo-js/store-sqlite";

export function sqliteProviders() {
  return {
    auth: "sqlite",
    signal: "sqlite",
    preKey: "sqlite",
    session: "sqlite",
    identity: "sqlite",
    senderKey: "sqlite",
    appState: "sqlite",
    privacyToken: "sqlite",
    messages: "none",
    threads: "none",
    contacts: "sqlite",
  };
}

// Cache domains (opt-in, default to memory). We persist `deviceList` to SQLite
// so the recipient device list resolved during a send survives reconnects and
// process restarts. Without this, recalling (revoking) a message sent in the
// last 15 minutes can fail with "direct fanout dropping primary recipient
// device without signal session": the in-memory device list is gone, the
// on-demand usync re-query at recall time can fail, and zapo falls back to the
// bare recipient jid which has no Signal session — so the revoke is dropped
// and the message stays in the recipient's chat.
export function sqliteCacheProviders() {
  return {
    deviceList: "sqlite",
  };
}

// Keep the device list fresh for 30 minutes — longer than the recall window
// (default 15 min) — so a recall never needs to re-query WhatsApp for devices
// (that query is the flaky step that drops the revoke).
const DEVICE_LIST_CACHE_TTL_MS = 30 * 60 * 1000;

function bufferJsonReviver(_key, value) {
  if (value && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return value;
}

function readBaileysMultiFile(dir) {
  const creds = JSON.parse(readFileSync(path.join(dir, "creds.json"), "utf8"), bufferJsonReviver);
  const keys = {};
  for (const file of readdirSync(dir)) {
    if (file === "creds.json") continue;
    const match = /^([a-z-]+)-(.+)\.json$/i.exec(file);
    if (!match) continue;
    const id = match[2].replace(/__/g, "/").replace(/-/g, ":");
    (keys[match[1]] ??= {})[id] = JSON.parse(readFileSync(path.join(dir, file), "utf8"), bufferJsonReviver);
  }
  return { creds, keys };
}

export async function createWhatsAppStore({ config, logger }) {
  await mkdir(config.AUTH_DIR, { recursive: true });
  const store = createStore({
    backends: {
      sqlite: createSqliteStore({
        path: config.SQLITE_PATH,
        driver: "auto",
        cacheTtlMs: { deviceListMs: DEVICE_LIST_CACHE_TTL_MS },
      }),
    },
    providers: sqliteProviders(),
    cacheProviders: sqliteCacheProviders(),
  });
  await migrateBaileysIfNeeded({ store, config, logger });
  return store;
}

async function migrateBaileysIfNeeded({ store, config, logger }) {
  if (existsSync(config.SQLITE_PATH)) return;
  if (!existsSync(path.join(config.BAILEYS_DIR, "creds.json"))) return;

  try {
    const { migrate, bufferJsonReviver: migrateReviver } = await import("wa-store-migrate");
    const creds = JSON.parse(
      readFileSync(path.join(config.BAILEYS_DIR, "creds.json"), "utf8"),
      migrateReviver || bufferJsonReviver
    );
    const baileys = readBaileysMultiFile(config.BAILEYS_DIR);
    baileys.creds = creds;
    const { data, losses = [] } = migrate({ from: "baileys", to: "zapo", data: baileys });
    for (const loss of losses) {
      logger.warn({ loss }, "baileys migrate note");
    }

    const session = store.session(config.SESSION_ID);
    if (data.credentials) await session.auth.save(data.credentials);
    for (const key of data.preKeys ?? []) await session.preKey.putPreKey(key);
    if (data.identities?.length) {
      await session.identity.setRemoteIdentities(
        data.identities.map((item) => ({
          address: item.address,
          identityKey: item.identityKey,
        }))
      );
    }
    if (data.sessions?.length) {
      await session.session.setSessionsBatch(
        data.sessions.map((item) => ({
          address: item.address,
          session: item.record,
        }))
      );
    }
    for (const senderKey of data.senderKeys ?? []) {
      await session.senderKey.upsertSenderKey(senderKey.record);
    }
    if (data.appState?.keys?.length) await session.appState.upsertSyncKeys(data.appState.keys);
    if (data.privacyTokens?.length) await session.privacyToken.upsertBatch(data.privacyTokens);
    console.log("Moved the previous WhatsApp login into Zapo. No new QR needed if it still holds.");
  } catch (error) {
    logger.warn({ err: error }, "could not migrate baileys session");
    console.log("Could not reuse the old login. Scan the QR once.");
  }
}

export async function clearSessionForRelink(store, sessionId, logger) {
  if (!store) return;
  const session = store.session(sessionId);
  const domains = [
    "auth",
    "signal",
    "preKey",
    "session",
    "identity",
    "senderKey",
    "appState",
    "retry",
    "groupMetadata",
    "deviceList",
    "messageSecret",
    "privacyToken",
    "contacts",
    "chatMetadata",
    "threads",
    "messages",
  ];
  for (const name of domains) {
    try {
      await session[name]?.clear?.();
    } catch (error) {
      logger.warn({ err: error, domain: name }, "could not clear store domain");
    }
  }
}

export async function destroyWhatsAppStore(store, logger) {
  if (!store) return;
  try {
    await store.destroy();
  } catch (error) {
    logger.warn({ err: error }, "could not destroy WhatsApp store");
  }
}

export function sessionIdPath(config) {
  return path.join(config.AUTH_DIR, "wa-session-id.json");
}

export function loadSessionId(config) {
  try {
    const raw = JSON.parse(readFileSync(sessionIdPath(config), "utf8"));
    const id = String(raw?.id || "").trim();
    if (id) return id;
  } catch {
    // First run or missing file.
  }
  return config.SESSION_ID;
}

export async function rotateSessionId(config) {
  const id = `s${Date.now()}`;
  await mkdir(config.AUTH_DIR, { recursive: true });
  await writeFile(sessionIdPath(config), `${JSON.stringify({ id }, null, 2)}\n`);
  return id;
}

export async function removeSqliteSessionFiles(config, logger) {
  const files = [
    config.SQLITE_PATH,
    `${config.SQLITE_PATH}-wal`,
    `${config.SQLITE_PATH}-shm`,
    `${config.SQLITE_PATH}-journal`,
  ];
  for (const file of files) {
    try {
      await rm(file, { force: true });
      console.log("[whatsapp] removed", file);
    } catch (error) {
      console.error("[whatsapp] could not remove", file, error.message || error);
      logger.warn({ err: error, file }, "could not remove WhatsApp sqlite file");
    }
  }
}

export async function loadWamPlugin(logger) {
  try {
    const { wamPlugin } = await import("@zapo-js/wam");
    return [wamPlugin()];
  } catch (error) {
    logger.warn({ err: error }, "wam plugin unavailable");
    return [];
  }
}
