import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listBatches,
  listBatchOrders,
  planOrder,
  resetOrder,
  skipOrder,
} from "../api/jobs";
import { getMachines } from "../api/references";
import BatchCompleteDialog from "../Components/BatchCompleteDialog";
import OrderDetails from "../Components/OrderDetails";
import OrderList from "../Components/OrderList";
import ReferenceModal from "../Components/ReferenceModal";
import { errorMessage } from "../utils/errors";
import {
  getSelectedBatch,
  getSelectedOrder,
  saveSelectedBatch,
  saveSelectedOrder,
} from "../utils/selectedBatch";
import "./Home.css";

// ---------------------------------------------------------------------
// Small pure helpers (no React). `orders` is always in sheet order.
// ---------------------------------------------------------------------

// The order to show first: the first pending one, or the very first.
function firstToShow(orders) {
  return (orders.find((o) => o.status === "pending") ?? orders[0])?.id ?? null;
}

// The next PENDING order after `fromId`; wraps round to the top. Orders that
// are already planned or skipped are jumped over. null = nothing pending left.
function nextPending(orders, fromId) {
  const at = orders.findIndex((o) => o.id === fromId);
  const after = orders.slice(at + 1).find((o) => o.status === "pending");
  const before = orders
    .slice(0, Math.max(at, 0))
    .find((o) => o.status === "pending");
  return after ?? before ?? null;
}

// Today's date, e.g. "Monday, 23 November 2026" (read from the computer's clock).
const todayText = () =>
  new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function PlanOrders() {
  const navigate = useNavigate(); // moves to another tab

  // ---------- Today's date (changes by itself when midnight passes) ----------
  const [today, setToday] = useState(todayText);
  useEffect(() => {
    const timer = setInterval(() => setToday(todayText()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // ---------- Data ----------
  const [machines, setMachines] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ---------- Actions on the selected order ----------
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [addingReference, setAddingReference] = useState(false);
  const [complete, setComplete] = useState(false);

  // ---------- Load the batches and machines once ----------
  useEffect(() => {
    let cancelled = false;
    let timer;

    // If the server is not ready yet (or the first request fails), try again
    // a little later instead of staying empty until the next upload.
    function load(attempt) {
      Promise.all([listBatches(), getMachines()])
        .then(([list, machineList]) => {
          if (cancelled) return;
          setBatches(list);
          setMachines(machineList);
          // The sheet chosen last time (here or on Job plans), else the newest upload.
          const saved = getSelectedBatch();
          const start = list.find((b) => String(b.id) === saved) ?? list[0];
          setBatchId(start?.id ?? null);
          setLoadError("");
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLoadError("Could not load your data. Trying again...");
          timer = setTimeout(
            () => load(attempt + 1),
            Math.min(2000 * (attempt + 1), 10000),
          );
        });
    }
    load(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // ---------- Load the orders whenever the batch changes ----------
  useEffect(() => {
    if (batchId === null) return;
    let cancelled = false; // ignore a late answer if the user already moved on
    setLoading(true);
    listBatchOrders(batchId)
      .then((list) => {
        if (cancelled) return;
        setOrders(list);
        // The order that was open last time in this sheet, else the first pending one.
        const savedOrder = getSelectedOrder(batchId);
        const back = list.find((o) => String(o.id) === savedOrder);
        setSelectedId(back ? back.id : firstToShow(list));
        setLoadError("");
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Could not load the orders of this batch.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const selectedIndex = orders.findIndex((o) => o.id === selectedId);

  // ---------- The user picked another sheet in the drop-down ----------
  function handleBatchChange(value) {
    const id =
      value === "" || value === null || value === undefined
        ? null
        : Number(value);
    if (id === batchId) return;
    setBatchId(id);
    if (id !== null) saveSelectedBatch(id); // the Job plans tab follows this choice
    // Clear everything that belonged to the old sheet. The orders of the new
    // sheet load by themselves (see the effect above).
    setOrders([]);
    setSelectedId(null);
    setActionError("");
    setAddingReference(false);
    setComplete(false);
  }

  // ---------- Moving between orders ----------
  function select(id) {
    setSelectedId(id);
    if (batchId !== null) saveSelectedOrder(batchId, id); // reopen here next time
    setActionError("");
  }

  function previous() {
    if (selectedIndex > 0) select(orders[selectedIndex - 1].id);
  }

  // After planning or skipping: show the next pending order, or finish.
  function advance(list, fromId) {
    const next = nextPending(list, fromId);
    if (next) select(next.id);
    else setComplete(true);
  }

  function replace(updated) {
    const list = orders.map((o) => (o.id === updated.id ? updated : o));
    setOrders(list);
    return list;
  }

  // ---------- Buttons ----------
  async function handleNext({ machine, ups, colours, sides }) {
    if (busy || !selected) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await planOrder(selected.id, {
        machine,
        ups,
        colours,
        sides,
      });
      advance(replace(updated), updated.id);
    } catch (err) {
      setActionError(errorMessage(err, "Could not save the plan"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    if (busy || !selected) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await skipOrder(selected.id);
      advance(replace(updated), updated.id);
    } catch (err) {
      setActionError(errorMessage(err, "Could not skip the order"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (busy || !selected) return;
    setBusy(true);
    setActionError("");
    try {
      replace(await resetOrder(selected.id)); // stay on it
    } catch (err) {
      setActionError(errorMessage(err, "Could not change the order"));
    } finally {
      setBusy(false);
    }
  }

  // The reference was saved in the popup: reload the orders so this order,
  // and every other order with the same reference, picks up its values.
  async function handleReferenceSaved() {
    setAddingReference(false);
    try {
      setOrders(await listBatchOrders(batchId));
    } catch {
      setLoadError(
        "The reference was saved, but the orders could not be reloaded. Refresh the page.",
      );
    }
  }

  const planned = orders.filter((o) => o.status === "planned").length;
  const skipped = orders.filter((o) => o.status === "skipped").length;

  return (
    <div className="home">
      <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{today}</p>

      <div className="sheet-picker">
        <label htmlFor="sheet-select">Sheet</label>
        <select
          id="sheet-select"
          value={batchId ?? ""}
          onChange={(e) => handleBatchChange(e.target.value)}
          disabled={batches.length === 0}
        >
          {batches.length === 0 && (
            <option value="">No sheets uploaded yet</option>
          )}
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.filename} · {new Date(b.uploaded_at).toLocaleDateString()} ·{" "}
              {b.total} orders
            </option>
          ))}
        </select>
        {batches.length === 0 && <Link to="/">Upload a sheet on Home</Link>}
      </div>

      {loadError && (
        <div className="error" role="alert" style={{ marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      <div className="home-grid">
        <OrderList
          orders={orders}
          selectedId={selectedId}
          onSelect={select}
          loading={loading}
        />

        {selected ? (
          <OrderDetails
            // A new key = fresh machine and UPs fields. It changes when the order
            // changes, and when its Main sheet reference appears (after "Add").
            key={`${selected.id}-${selected.reference?.id ?? "none"}`}
            order={selected}
            machines={machines}
            busy={busy}
            error={actionError}
            canPrevious={selectedIndex > 0}
            onPrevious={previous}
            onSkip={handleSkip}
            onReset={handleReset}
            onNext={handleNext}
            onAddReference={() => setAddingReference(true)}
          />
        ) : (
          <div className="detail-placeholder">
            {loading
              ? "Loading..."
              : batchId !== null && orders.length === 0
                ? "This sheet has no orders left. They were moved to a newer upload of the same orders. Delete the sheet if you no longer need it."
                : "Upload an Excel sheet, then pick an order to see its details here."}
          </div>
        )}
      </div>

      {addingReference && selected && (
        <ReferenceModal
          reference={{ name: selected.reference_name }}
          lockName
          hint={`Needed for order ${selected.so_number}. Every order with this reference will use these values.`}
          onClose={() => setAddingReference(false)}
          onSaved={handleReferenceSaved}
        />
      )}

      {complete && (
        <BatchCompleteDialog
          planned={planned}
          skipped={skipped}
          onStay={() => setComplete(false)}
          onOpenPlans={() => navigate("/job-plans")}
        />
      )}
    </div>
  );
}
