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

// Colours and sides are stored in a small integer column (max 32,767).
const isCount = (n) => Number.isInteger(n) && n >= 1 && n <= 32767;

// "24" -> 24, "" -> NaN
const toNum = (t) => (t ? parseInt(t, 10) : NaN);

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
// Pass `editor` to give the box an Edit / Done button and a number input.
function Tile({ label, value, note, accent, editor }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`tile${accent ? " accent" : ""}`}>
      <div className="tile-label">
        <span>{label}</span>
        {editor && (
          <button
            type="button"
            className="tile-edit"
            onClick={editor.onToggle}
            disabled={editor.disabled}
          >
            {editor.editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {editor?.editing ? (
        <input
          className="tile-input"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          aria-label={label}
          value={editor.text}
          onChange={(e) => editor.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // Enter closes the editor, it must not submit the form
              editor.onToggle();
            }
          }}
        />
      ) : (
        <div className={`tile-value${empty ? " dim" : ""}`}>
          {empty ? "-" : value}
        </div>
      )}

      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}

/**
 * The details box for ONE order.
 *
 * The parent gives this component a `key` that changes when the order
 * changes, so the machine, UPs, colours and sides start fresh for every order.
 * Starting values: the saved plan if there is one, otherwise the Main sheet.
 *
 * Props:
 *   order, machines    - the order, and the machine names for the dropdown
 *   busy, error        - a request is running / the last request failed
 *   canPrevious        - false on the first order
 *   onPrevious, onSkip, onReset, onAddReference - button actions
 *   onNext({machine, ups, colours, sides}) - save the plan and move on
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

  // ---------- Form state ----------
  const [machine, setMachine] = useState(
    order.job?.machine ?? ref?.default_machine ?? "",
  );
  const [upsText, setUpsText] = useState(
    String(order.job?.ups ?? ref?.ups ?? ""),
  );
  const [coloursText, setColoursText] = useState(
    String(order.job?.colours ?? ref?.colours ?? ""),
  );
  const [sidesText, setSidesText] = useState(
    String(order.job?.sides ?? ref?.sides ?? ""),
  );
  // Which tiles are currently showing an input instead of a number
  const [editing, setEditing] = useState({
    ups: false,
    colours: false,
    sides: false,
  });
  const [attempted, setAttempted] = useState(false); // has Next been clicked?

  // ---------- Values worked out from the form ----------
  const ups = toNum(upsText);
  const colours = toNum(coloursText);
  const sides = toNum(sidesText);

  const result = ref ? calculate(order.quantity, ups, sides, colours) : null;
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  const problems = {};
  if (!machine) problems.machine = "Select a machine";
  if (!isValidUps(ups))
    problems.ups = "UPs must be a whole number from 1 to 100,000";
  if (!isCount(colours))
    problems.colours = "Colours must be a whole number of 1 or more";
  if (!isCount(sides))
    problems.sides = "Sides must be a whole number of 1 or more";
  if (tooLarge)
    problems.total =
      "Total clicks would be too large. Check UPs, colours and sides";

  // Machine errors wait for the first Next click.
  const showMachine = attempted ? problems.machine : undefined;

  // Builds the `editor` prop for one of the three editable tiles.
  const editor = (key, text, setText) => ({
    editing: editing[key],
    text,
    onChange: (v) => setText(v.replace(/\D/g, "").slice(0, 6)), // digits only
    onToggle: () => setEditing((e) => ({ ...e, [key]: !e[key] })),
    disabled: !ref || busy,
  });

  // "From the Main sheet", or "Edited (Main sheet: 24)" once it differs.
  const sourceNote = (current, original) =>
    ref && current !== original
      ? `Edited (Main sheet: ${fmt(original)})`
      : "From the Main sheet";

  // ---------- The status line next to the buttons ----------
  let statusText;
  let statusTone; // "idle" (grey dot), "ready" (green dot), "warn" (red dot)
  if (!ref) {
    statusText = "Add this reference to the Main sheet first";
    statusTone = "warn";
  } else if (Object.keys(problems).length > 0) {
    statusText = "Choose a machine and check the UPs, colours and sides";
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
    onNext({ machine, ups, colours, sides });
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
      </div>

      {/* ----- Breakdown: updates as the values change ----- */}
      <section className="breakdown" aria-label="Job breakdown">
        <div className="breakdown-head">
          <h3>Job breakdown</h3>
          <span className="pill">Auto computed</span>
        </div>
        <div className="tiles">
          <Tile
            label="Number of UPs"
            value={isValidUps(ups) ? fmt(ups) : ""}
            note={
              ref && ups !== ref.ups
                ? `Edited (Main sheet: ${fmt(ref.ups)})`
                : "From the Main sheet"
            }
            editor={editor("ups", upsText, setUpsText)}
          />
          <Tile
            label="Number of colours"
            value={isCount(colours) ? fmt(colours) : ""}
            note={
              ref && colours !== ref.colours
                ? `Edited (Main sheet: ${fmt(ref.colours)})`
                : "From the Main sheet"
            }
            editor={editor("colours", coloursText, setColoursText)}
          />
          <Tile
            label="Number of sides"
            value={isCount(sides) ? fmt(sides) : ""}
            note={
              ref && sides !== ref.sides
                ? `Edited (Main sheet: ${fmt(ref.sides)})`
                : "From the Main sheet"
            }
            editor={editor("sides", sidesText, setSidesText)}
          />
        </div>
        <div className="tiles results">
          <Tile
            label="Impressions"
            value={fmt(result?.impressions)}
            note="Quantity ÷ UPs, rounded"
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

      {/* ----- Errors for the editable tiles ----- */}
      {ref &&
        ["ups", "colours", "sides", "total"].map(
          (k) =>
            problems[k] && (
              <div key={k} className="field-error">
                {problems[k]}
              </div>
            ),
        )}

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
