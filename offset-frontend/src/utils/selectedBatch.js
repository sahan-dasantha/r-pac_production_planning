// Remembers where the planner stopped, so the app opens at the same place next time.
// Put this file in src/utils/. Everything is kept in the browser (localStorage).
const BATCH_KEY = "planner.selectedBatch";
const ORDER_KEY = "planner.selectedOrder";

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage is blocked: the app simply starts fresh next time
  }
}

// ---- the selected Excel sheet (shared by the Home and Job plans tabs) ----
// The saved batch id as text ("12"), or "all" / "none", or null when nothing is saved.
export function getSelectedBatch() {
  return read(BATCH_KEY, null);
}

export function saveSelectedBatch(id) {
  write(BATCH_KEY, String(id));
}

// ---- the order that was open on the Home tab, for each sheet ----
export function getSelectedOrder(batchId) {
  try {
    const all = JSON.parse(read(ORDER_KEY, "{}"));
    return all[String(batchId)] ?? null;
  } catch {
    return null;
  }
}

export function saveSelectedOrder(batchId, orderId) {
  try {
    const all = JSON.parse(read(ORDER_KEY, "{}"));
    all[String(batchId)] = String(orderId);
    write(ORDER_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
