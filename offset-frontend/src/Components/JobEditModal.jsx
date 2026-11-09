import { useEffect, useRef, useState } from "react";
import { getMachines } from "../api/references";
import { updateJob } from "../api/jobs";
import { calculate, MAX_DB_INT } from "../utils/calc";
import { formatDateInput, isoToDisplay, parseDateInput } from "../utils/dates";
import { errorMessage } from "../utils/errors";

const fmt = (n) => n.toLocaleString("en-US");

/**
 * Popup for editing ONE saved job.
 * Props:
 *   job     - the job being edited (from the table)
 *   onClose - user cancelled
 *   onSaved - the backend accepted the change
 */
export default function JobEditModal({ job, onClose, onSaved }) {
  // The form starts with the job's current values.
  const [dateText, setDateText] = useState(isoToDisplay(job.date));
  const [quantityText, setQuantityText] = useState(String(job.quantity));
  const [machine, setMachine] = useState(job.machine);
  const [machines, setMachines] = useState([]);
  const [attempted, setAttempted] = useState(false); // has Save been clicked?
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dateRef = useRef(null);

  // Load the machine list, and put the cursor in the date field.
  useEffect(() => {
    getMachines()
      .then(setMachines)
      .catch(() => {});
    dateRef.current?.focus();
  }, []);

  // Escape closes the popup (unless a save is running).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  // ---------- Values worked out from the form ----------
  const quantity = quantityText ? parseInt(quantityText, 10) : 0;
  const dateISO = parseDateInput(dateText);

  // Live preview, using the job's OWN saved ups, colours and sides.
  const result =
    quantity >= 1 ? calculate(quantity, job.ups, job.sides, job.colours) : null;
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  const problems = {};
  if (!dateISO) problems.date = "Enter a valid date as DD/MM/YYYY";
  if (quantity < 1) problems.quantity = "Enter a quantity of 1 or more";
  else if (tooLarge) problems.quantity = "This quantity is too large";
  if (!machine) problems.machine = "Select a machine";
  const show = (f) => (attempted ? problems[f] : undefined);

  // ---------- Save ----------
  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setAttempted(true);
    setError("");
    if (Object.keys(problems).length > 0) return;

    // Nothing changed -> just close, no request needed.
    if (
      dateISO === job.date &&
      quantity === job.quantity &&
      machine === job.machine
    ) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updated = await updateJob(job.id, {
        date: dateISO,
        quantity,
        machine,
      });
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err, "Could not save the changes"));
    } finally {
      setSaving(false);
    }
  }

  return (
    // The backdrop has no onClick, so a stray click cannot throw away edits.
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit job"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2>Edit job</h2>
        {error && <div className="error">{error}</div>}

        {/* Cannot be changed: it decides the ups, colours and sides */}
        <label>Reference</label>
        <div className="edit-ro">{job.reference_name}</div>
        <p className="edit-hint">
          To use a different reference, delete this job and add a new one.
        </p>

        <div className="row">
          <div>
            <label>UPs</label>
            <div className="edit-ro">{fmt(job.ups)}</div>
          </div>
          <div>
            <label>Colours</label>
            <div className="edit-ro">{fmt(job.colours)}</div>
          </div>
          <div>
            <label>Sides</label>
            <div className="edit-ro">{fmt(job.sides)}</div>
          </div>
        </div>

        <label htmlFor="edit-date">Date</label>
        <input
          id="edit-date"
          ref={dateRef}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          autoComplete="off"
          value={dateText}
          onChange={(e) => setDateText(formatDateInput(e.target.value))}
        />
        {show("date") && <div className="field-error">{show("date")}</div>}

        <label htmlFor="edit-quantity">Quantity</label>
        <input
          id="edit-quantity"
          inputMode="numeric"
          autoComplete="off"
          value={quantityText}
          onChange={(e) =>
            setQuantityText(e.target.value.replace(/\D/g, "").slice(0, 9))
          }
        />
        {show("quantity") && (
          <div className="field-error">{show("quantity")}</div>
        )}

        <label htmlFor="edit-machine">Machine</label>
        <select
          id="edit-machine"
          value={machine}
          onChange={(e) => setMachine(e.target.value)}
        >
          <option value="">Select machine</option>
          {machines.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {show("machine") && (
          <div className="field-error">{show("machine")}</div>
        )}

        {/* The three calculated values, updating as the quantity changes */}
        <div className="edit-preview">
          <div>
            Impressions{" "}
            <strong>{result ? fmt(result.impressions) : "-"}</strong>
          </div>
          <div>
            Total impressions{" "}
            <strong>{result ? fmt(result.totalImpressions) : "-"}</strong>
          </div>
          <div>
            Total clicks{" "}
            <strong>{result ? fmt(result.totalClicks) : "-"}</strong>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
