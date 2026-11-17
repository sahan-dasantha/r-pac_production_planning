import { useEffect, useRef, useState } from "react";

const FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["planned", "Planned"],
  ["skipped", "Skipped"],
];

const fmt = (n) => n.toLocaleString("en-US");

// Every typed word must appear somewhere in the SO number, reference or
// customer (any order, any case): "mini mb" finds "FG_LV_H1 22-T3-MINI MB_...".
function matches(order, words) {
  const text =
    `${order.so_number} ${order.reference_name} ${order.customer}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The left box: progress counter, search, status filter and the numbered,
 * scrollable list of SO numbers.
 *
 * Props:
 *   orders     - every order of the batch, in sheet order
 *   selectedId - the order shown in the details box
 *   onSelect   - called with an order id when a row is clicked
 *   loading    - true while the orders are being fetched
 */
export default function OrderList({ orders, selectedId, onSelect, loading }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const listRef = useRef(null);

  const counts = { all: orders.length, pending: 0, planned: 0, skipped: 0 };
  for (const o of orders) counts[o.status] += 1;

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = orders.filter(
    (o) =>
      (filter === "all" || o.status === filter) &&
      (words.length === 0 || matches(o, words)),
  );

  const percent = counts.all ? (counts.planned / counts.all) * 100 : 0;

  // Keep the selected row visible when Next / Previous move the selection.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, filter]);

  return (
    <section className="so-card" aria-label="Sales orders">
      <div className="card-head">
        <h2>Sales orders</h2>
        <span className="card-tag">{fmt(orders.length)} in this batch</span>
      </div>

      {/* Progress counter: "142 / 1,500 planned" */}
      <div className="progress-text" role="status">
        <span>
          <strong>
            {fmt(counts.planned)} / {fmt(counts.all)}
          </strong>{" "}
          planned
        </span>
        {counts.skipped > 0 && (
          <span className="muted">{fmt(counts.skipped)} skipped</span>
        )}
      </div>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={counts.all}
        aria-valuenow={counts.planned}
        aria-label="Orders planned"
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <input
        type="search"
        placeholder="Search SO, reference or customer..."
        aria-label="Search sales orders"
        autoComplete="off"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="chips" role="group" aria-label="Filter by status">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} {fmt(counts[key])}
          </button>
        ))}
      </div>

      <div className="so-list" ref={listRef} role="list">
        {loading && <div className="so-empty">Loading orders...</div>}
        {!loading && orders.length === 0 && (
          <div className="so-empty">
            Upload a sheet to see its SO numbers here.
          </div>
        )}
        {!loading && orders.length > 0 && shown.length === 0 && (
          <div className="so-empty">No orders match.</div>
        )}

        {!loading &&
          shown.map((o) => (
            <button
              key={o.id}
              type="button"
              role="listitem"
              className={`so-item ${o.status}`}
              aria-current={o.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(o.id)}
            >
              <span className="so-num">{o.position}</span>
              <span className="so-no">{o.so_number}</span>
              {o.status === "pending" && !o.reference && (
                <span className="tag noref">no ref</span>
              )}
              {o.status === "planned" && (
                <span className="tag planned">Planned</span>
              )}
              {o.status === "skipped" && (
                <span className="tag skipped">Skipped</span>
              )}
            </button>
          ))}
      </div>
    </section>
  );
}
