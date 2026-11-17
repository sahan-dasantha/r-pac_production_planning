import { useState } from "react";
import { calculate, isValidUps, MAX_DB_INT } from "../utils/calc";
import { isoToDisplay } from "../utils/dates";

// 1563 -> "1,563"   (null/undefined -> "")
const fmt = (n) =>
  n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const STATUS_LABEL = {
  pending: "Pending",
  planned: "Planned",
  skipped: "Skipped",
};

// A small grey label with its value underneath (the read-only facts).
function Fact({ label, value }) {
  return (
    <div>
      <div className="detail-label">{label}</div>
      <div className="fact-value">{value || "-"}</div>
    </div>
  );
}

// One box in the dark breakdown panel.
function Tile({ label, value, note, accent }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`tile${accent ? " accent" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className={`tile-value${empty ? " dim" : ""}`}>
        {empty ? "-" : value}
      </div>
      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}

/**
 * The details box for ONE order.
 *
 * The parent gives this component a `key` that changes when the order
 * changes, so the machine and UPs fields start fresh for every order.
 * Starting values: the saved plan if there is one, otherwise the Main
 * sheet's UPs and usual machine.
 *
 * Props:
 *   order, machines    - the order, and the machine names for the dropdown
 *   busy, error        - a request is running / the last request failed
 *   canPrevious        - false on the first order
 *   onPrevious, onSkip, onReset, onAddReference - button actions
 *   onNext({machine, ups}) - save the plan and move on
 */
export default function OrderDetails({
  order,
  machines,
  busy,
  error,
  canPrevious,
  onPrevious,
  onSkip,
  onReset,
  onNext,
  onAddReference,
}) {
  const ref = order.reference; // null when the reference is not in the Main sheet
  const [machine, setMachine] = useState(
    order.job?.machine ?? ref?.default_machine ?? "",
  );
  const [upsText, setUpsText] = useState(
    String(order.job?.ups ?? ref?.ups ?? ""),
  );
  const [attempted, setAttempted] = useState(false); // has Next been clicked?

  // ---------- Values worked out from the form ----------
  const ups = upsText ? parseInt(upsText, 10) : NaN;
  const result = ref
    ? calculate(order.quantity, ups, ref.sides, ref.colours)
    : null;
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  const problems = {};
  if (!machine) problems.machine = "Select a machine";
  if (!isValidUps(ups))
    problems.ups = "UPs must be a whole number from 1 to 100,000";
  else if (tooLarge)
    problems.ups = "UPs is too low: total clicks would be too large";
  // Machine errors wait for the first Next click; UPs errors show as soon as
  // something has been typed (or cleared).
  const showMachine = attempted ? problems.machine : undefined;
  const showUps =
    attempted || upsText !== String(ref?.ups ?? "") ? problems.ups : undefined;

  // ---------- The status line next to the buttons ----------
  let statusText;
  let statusTone; // "idle" (grey dot), "ready" (green dot), "warn" (red dot)
  if (!ref) {
    statusText = "Add this reference to the Main sheet first";
    statusTone = "warn";
  } else if (Object.keys(problems).length > 0) {
    statusText = "Choose a machine and check the UPs";
    statusTone = "idle";
  } else if (order.status === "planned") {
    statusText = "Already planned. Next saves any change";
    statusTone = "ready";
  } else {
    statusText = "Ready to plan this order";
    statusTone = "ready";
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (busy || !ref) return;
    setAttempted(true);
    if (Object.keys(problems).length > 0) return; // show the errors
    onNext({ machine, ups });
  }

  return (
    <form className="detail-card" onSubmit={handleSubmit} noValidate>
      {/* ----- Reference and SO number ----- */}
      <div className="detail-head">
        <div>
          <div className="detail-label">Reference</div>
          <h2 className="detail-ref">{order.reference_name}</h2>
        </div>
        <div className="detail-so">
          <div className="detail-label">SO number</div>
          <div className="so-big">{order.so_number}</div>
          <span className={`tag ${order.status}`}>
            {STATUS_LABEL[order.status]}
          </span>
        </div>
      </div>

      {/* ----- Facts from the uploaded sheet ----- */}
      <div className="facts">
        <Fact label="Order type" value={order.order_type} />
        <Fact label="Customer" value={order.customer} />
        <Fact
          label="Order place date"
          value={
            order.order_place_date ? isoToDisplay(order.order_place_date) : ""
          }
        />
        <Fact label="Number of changes" value={fmt(order.noc)} />
        <Fact label="Quantity" value={fmt(order.quantity)} />
        <Fact label="Value" value={fmt(order.value)} />
      </div>

      {/* ----- Reference missing from the Main sheet ----- */}
      {!ref && (
        <div className="missing-ref" role="alert">
          <span>This reference is not in the Main sheet yet.</span>
          <button type="button" onClick={onAddReference} disabled={busy}>
            Add reference
          </button>
        </div>
      )}

      {/* ----- What the planner chooses ----- */}
      <div className="plan-fields">
        <div>
          <label htmlFor="plan-machine">Machine</label>
          <select
            id="plan-machine"
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            disabled={!ref}
          >
            <option value="">Select machine</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {ref?.default_machine && machine === ref.default_machine && (
            <div className="hint">Usual machine for this reference</div>
          )}
          {showMachine && <div className="field-error">{showMachine}</div>}
        </div>

        <div>
          <label htmlFor="plan-ups">Number of UPs</label>
          <input
            id="plan-ups"
            inputMode="numeric"
            autoComplete="off"
            value={upsText}
            disabled={!ref}
            // keep digits only, max 6 characters
            onChange={(e) =>
              setUpsText(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
          {ref && ups !== ref.ups && (
            <div className="hint">
              Main sheet value: {fmt(ref.ups)}{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => setUpsText(String(ref.ups))}
              >
                Use it
              </button>
            </div>
          )}
          {showUps && <div className="field-error">{showUps}</div>}
        </div>
      </div>

      {/* ----- Breakdown: updates as the UPs change ----- */}
      <section className="breakdown" aria-label="Job breakdown">
        <div className="breakdown-head">
          <h3>Job breakdown</h3>
          <span className="pill">Auto computed</span>
        </div>
        <div className="tiles">
          <Tile
            label="Number of UPs"
            value={isValidUps(ups) ? fmt(ups) : ""}
            note="Editable above"
          />
          <Tile
            label="Number of colours"
            value={fmt(ref?.colours)}
            note="From the Main sheet"
          />
          <Tile
            label="Number of sides"
            value={fmt(ref?.sides)}
            note="From the Main sheet"
          />
        </div>
        <div className="tiles results">
          <Tile
            label="Impressions"
            value={fmt(result?.impressions)}
            note="Quantity ÷ UPs, rounded up"
          />
          <Tile
            label="Total impressions"
            value={fmt(result?.totalImpressions)}
            note="Impressions × sides"
          />
          <Tile
            accent
            label="Total clicks"
            value={fmt(result?.totalClicks)}
            note="Total impressions × colours"
          />
        </div>
      </section>

      {error && (
        <div className="error detail-error" role="alert">
          {error}
        </div>
      )}

      {/* ----- Bottom bar ----- */}
      <div className="nav-bar">
        <span className={`status ${statusTone}`} role="status">
          {statusText}
        </span>
        <div className="nav-buttons">
          <button
            type="button"
            className="secondary"
            onClick={onPrevious}
            disabled={!canPrevious || busy}
          >
            Previous
          </button>
          {order.status === "skipped" ? (
            <button
              type="button"
              className="secondary"
              onClick={onReset}
              disabled={busy}
            >
              Back to pending
            </button>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={onSkip}
              disabled={busy}
            >
              Skip
            </button>
          )}
          <button type="submit" className="next" disabled={busy || !ref}>
            {busy ? "Saving..." : "Next"}
          </button>
        </div>
      </div>
    </form>
  );
}
