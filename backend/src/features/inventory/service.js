import { createJsonStore } from "../../infrastructure/json-file.js";

const DEFAULT_LABEL = "Aid portions";

/**
 * Inventory for the physical aid stock at the pickup desk.
 *
 * A single counter (e.g. "200 portions"). Every time a beneficiary
 * collects aid (pickup:mark) the count goes -1. When it reaches 0,
 * collecting is blocked until the stock is restocked. A low-stock
 * warning is surfaced to the UI when the count drops under 20.
 *
 * Persisted to disk so a restart / Wi-Fi drop never loses the count.
 */
export function createInventoryService(ctx) {
  const { INVENTORY_PATH } = ctx.config;
  const store = createJsonStore(INVENTORY_PATH, { count: 0, label: DEFAULT_LABEL, updatedAt: null });
  let state = { count: 0, label: DEFAULT_LABEL, updatedAt: null };

  function load() {
    const raw = store.read();
    const count = Math.max(0, Math.trunc(Number(raw?.count) || 0));
    state = {
      count,
      label: String(raw?.label || DEFAULT_LABEL),
      updatedAt: raw?.updatedAt ? Number(raw.updatedAt) : null,
    };
    return state;
  }

  async function persist() {
    await store.write(state);
  }

  function publicState() {
    return { count: state.count, label: state.label, updatedAt: state.updatedAt };
  }

  function emit(socket) {
    const payload = publicState();
    if (socket) socket.emit("inventory:state", payload);
    else ctx.io.emit("inventory:state", payload);
  }

  function get() {
    return publicState();
  }

  function isBlocked() {
    return state.count <= 0;
  }

  async function set({ count, label } = {}) {
    const nextCount = Math.max(0, Math.trunc(Number(count) || 0));
    state = {
      count: nextCount,
      label: label !== undefined && label !== null ? String(label || DEFAULT_LABEL) : state.label,
      updatedAt: Date.now(),
    };
    await persist();
    emit();
    return publicState();
  }

  // -1 for a new collection. Caller must check isBlocked() first; this is a
  // no-op if the count is already 0 (defensive — never goes negative).
  async function decrement() {
    if (state.count <= 0) return publicState();
    state = { ...state, count: state.count - 1, updatedAt: Date.now() };
    await persist();
    emit();
    return publicState();
  }

  // +1 when a collection is undone (the aid returns to stock).
  async function increment() {
    state = { ...state, count: state.count + 1, updatedAt: Date.now() };
    await persist();
    emit();
    return publicState();
  }

  load();

  return { load, get, set, decrement, increment, isBlocked, publicState, emit };
}
