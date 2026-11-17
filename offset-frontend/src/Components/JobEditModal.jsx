import { useEffect, useRef, useState } from "react";
import { getMachines } from "../api/references";
import { updateJob } from "../api/jobs";
import { calculate, isValidUps, MAX_DB_INT } from "../utils/calc";
import { errorMessage } from "../utils/errors";

const fmt = (n) => n.toLocaleString("en-US");

/**
 * Popup for editing ONE saved job plan. Only the machine and the UPs can be
 * changed: the quantity and reference come from the uploaded order.
 *
 * Props:
 *   job     - the job being edited (from the table)
 *   onClose - user cancelled
 *   onSaved - the backend accepted the change (receives the updated job)
 */
export default function JobEditModal({ job, onClose, onSaved }) {
  // The form starts with the job's current values.
  const [machine, setMachine] = useState(job.machine);
  const [upsText, setUpsText] = useState(String(job.ups));
  const [machines, setMachines] = useState([]);
  const [attempted, setAttempted] = useState(false); // has Save been clicked?
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const machineRef = useRef(null);

  // Load the machine list, and put the cursor in the machine field.
  useEffect(() => {
    getMachines()
      .then(setMachines)
      .catch(() => {});
    machineRef.current?.focus();
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
  const ups = upsText ? parseInt(upsText, 10) : NaN;
  // Live preview, using the job's OWN saved quantity, colours and sides.
  const result = calculate(job.quantity, ups, job.sides, job.colours);
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  const problems = {};
  if (!machine) problems.machine = "Select a machine";
  if (!isValidUps(ups))
    problems.ups = "UPs must be a whole number from 1 to 100,000";
  else if (tooLarge)
    problems.ups = "UPs is too low: total clicks would be too large";
  const show = (f) => (attempted ? problems[f] : undefined);

  // ---------- Save ----------
  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setAttempted(true);
    setError("");
    if (Object.keys(problems).length > 0) return;

    // Nothing changed -> just close, no request needed.
    if (machine === job.machine && ups === job.ups) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updated = await updateJob(job.id, { machine, ups });
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
        aria-label="Edit job plan"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2>Edit job plan</h2>
        {error && <div className="error">{error}</div>}

        <label>SO number</label>
        <div className="edit-ro">{job.so_number}</div>

        <label>Reference</label>
        <div className="edit-ro">{job.reference_name}</div>
        <p className="edit-hint">
          The quantity and reference come from the uploaded order. To plan a
          different reference, delete this plan and plan the order again.
        </p>

        <div className="row">
          <div>
            <label>Quantity</label>
            <div className="edit-ro">{fmt(job.quantity)}</div>
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

        <label htmlFor="edit-machine">Machine</label>
        <select
          id="edit-machine"
          ref={machineRef}
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

        <label htmlFor="edit-ups">Number of UPs</label>
        <input
          id="edit-ups"
          inputMode="numeric"
          autoComplete="off"
          value={upsText}
          onChange={(e) =>
            setUpsText(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
        />
        {show("ups") && <div className="field-error">{show("ups")}</div>}

        {/* The three calculated values, updating as the UPs change */}
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
