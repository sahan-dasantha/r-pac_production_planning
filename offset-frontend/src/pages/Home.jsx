import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listBatches,
  listBatchOrders,
  planOrder,
  resetOrder,
  skipOrder,
  uploadBatch,
} from "../api/jobs";
import { getMachines } from "../api/references";
import BatchCompleteDialog from "../Components/BatchCompleteDialog";
import OrderDetails from "../Components/OrderDetails";
import OrderList from "../Components/OrderList";
import ReferenceModal from "../Components/ReferenceModal";
import UploadPanel from "../Components/UploadPanel";
import { errorMessage } from "../utils/errors";
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

const plural = (n, word) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export default function Home() {
  const navigate = useNavigate(); // moves to another tab

  // ---------- Data ----------
  const [machines, setMachines] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ---------- Upload ----------
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [problems, setProblems] = useState(null);
  const [uploadNote, setUploadNote] = useState("");

  // ---------- Actions on the selected order ----------
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [addingReference, setAddingReference] = useState(false);
  const [complete, setComplete] = useState(false);

  // ---------- Load the batches and machines once ----------
  useEffect(() => {
    Promise.all([listBatches(), getMachines()])
      .then(([list, machineList]) => {
        setBatches(list);
        setMachines(machineList);
        setBatchId(list[0]?.id ?? null); // the newest upload
      })
      .catch(() =>
        setLoadError("Could not load your data. Is the server running?"),
      )
      .finally(() => setLoading(false));
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
        setSelectedId(firstToShow(list));
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

  // ---------- Upload an Excel sheet ----------
  async function handleUpload(file) {
    setUploading(true);
    setUploadError("");
    setProblems(null);
    setUploadNote("");
    try {
      const data = await uploadBatch(file);
      setBatches(await listBatches());
      setBatchId(data.batch.id); // the orders load by themselves
      const parts = [`${plural(data.created, "new order")}`];
      if (data.overwritten)
        parts.push(`${data.overwritten.toLocaleString("en-US")} overwritten`);
      if (data.plans_reset)
        parts.push(
          `${plural(data.plans_reset, "plan")} reset (quantity or reference changed)`,
        );
      let note = `${file.name}: ${parts.join(", ")}.`;
      if (data.missing_references) {
        note += ` ${plural(data.missing_references, "reference")} not in the Main sheet yet.`;
      }
      setUploadNote(note);
    } catch (err) {
      const body = err.response?.data;
      if (body?.errors) {
        setProblems({
          detail: body.detail,
          total: body.error_count,
          errors: body.errors,
        });
      } else {
        setUploadError(errorMessage(err, "Upload failed"));
      }
    } finally {
      setUploading(false);
    }
  }

  // ---------- Moving between orders ----------
  function select(id) {
    setSelectedId(id);
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
      <UploadPanel
        batches={batches}
        batchId={batchId}
        onBatchChange={setBatchId}
        onUpload={handleUpload}
        uploading={uploading}
        error={uploadError}
        problems={problems}
        note={uploadNote}
      />

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
