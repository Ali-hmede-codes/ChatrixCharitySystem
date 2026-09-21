// Offline persistence for the Aid Pickup desk.
//
// Two object stores:
//   - `snapshot`: a single record (key = "current") holding the last known
//     pickup dataset (campaigns + recipients + pickups) and inventory, plus
//     the timestamp it was saved. This is what the desk searches against
//     when the server is unreachable.
//   - `queue`: append-only list of pickup operations (mark / reprint / undo)
//     performed while offline. Each gets an auto-increment id so order is
//     preserved. Replayed to the server on reconnect (see AppContext flush).
//
// Everything here is promise-based and defensive: a missing/corrupted
// IndexedDB (private mode, quota) degrades to "no cache" instead of
// throwing, so the online path is never broken by offline storage.

const DB_NAME = "ziko-offline";
const DB_VERSION = 1;
const SNAPSHOT_KEY = "current";

let dbPromise = null;
let dbBroken = false;

function openDb() {
  if (dbBroken) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      dbBroken = true;
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbBroken = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("snapshot")) {
        db.createObjectStore("snapshot", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbBroken = true;
      resolve(null);
    };
    req.onblocked = () => {
      // Another tab is blocking the upgrade; retry once on the next call.
      dbPromise = null;
      resolve(null);
    };
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function promisify(request) {
  return new Promise((resolve) => {
    if (!request) return resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// --- Snapshot -----------------------------------------------------------------

export async function saveSnapshot(snapshot) {
  const db = await openDb();
  if (!db) return;
  try {
    const store = tx(db, "snapshot", "readwrite");
    const record = { key: SNAPSHOT_KEY, savedAt: Date.now(), ...snapshot };
    await promisify(store.put(record));
  } catch {
    // Ignore — cache is best-effort.
  }
}

export async function loadSnapshot() {
  const db = await openDb();
  if (!db) return null;
  try {
    const store = tx(db, "snapshot", "readonly");
    const record = await promisify(store.get(SNAPSHOT_KEY));
    if (!record) return null;
    return {
      savedAt: Number(record.savedAt) || 0,
      campaigns: Array.isArray(record.campaigns) ? record.campaigns : [],
      inventory:
        record.inventory && typeof record.inventory === "object"
          ? record.inventory
          : { count: 0, label: "Aid portions", updatedAt: null },
    };
  } catch {
    return null;
  }
}

export async function clearSnapshot() {
  const db = await openDb();
  if (!db) return;
  try {
    const store = tx(db, "snapshot", "readwrite");
    await promisify(store.delete(SNAPSHOT_KEY));
  } catch {
    // Ignore.
  }
}

// --- Queue -------------------------------------------------------------------

export async function enqueueOp(op) {
  const db = await openDb();
  if (!db) return null;
  try {
    const store = tx(db, "queue", "readwrite");
    const record = { ...op, queuedAt: Date.now() };
    const req = store.add(record);
    const id = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return id;
  } catch {
    return null;
  }
}

export async function listQueue() {
  const db = await openDb();
  if (!db) return [];
  try {
    const store = tx(db, "queue", "readonly");
    const all = await promisify(store.getAll());
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

export async function removeFromQueue(id) {
  const db = await openDb();
  if (!db) return;
  try {
    const store = tx(db, "queue", "readwrite");
    await promisify(store.delete(id));
  } catch {
    // Ignore.
  }
}

export async function clearQueue() {
  const db = await openDb();
  if (!db) return;
  try {
    const store = tx(db, "queue", "readwrite");
    await promisify(store.clear());
  } catch {
    // Ignore.
  }
}

export async function queueCount() {
  const db = await openDb();
  if (!db) return 0;
  try {
    const store = tx(db, "queue", "readonly");
    const count = await promisify(store.count());
    return Number(count) || 0;
  } catch {
    return 0;
  }
}
