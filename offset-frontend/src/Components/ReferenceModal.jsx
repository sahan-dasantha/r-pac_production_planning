import { useEffect, useState } from "react";
import {
  createReference,
  updateReference,
  getHistory,
  getMachines,
} from "../api/references";

/**
 * Add or edit one Main sheet reference.
 *
 * Props:
 *   reference - { id, name, ups, ... } to edit, or {} / { name } to add a new one
 *   lockName  - true when the name came from an order and must not be changed
 *   hint      - a line of explanation shown under the title
 *   onClose   - user cancelled
 *   onSaved   - called with the saved reference
 */
export default function ReferenceModal({
  reference,
  lockName,
  hint,
  onClose,
  onSaved,
}) {
  const isEdit = Boolean(reference.id);
  const [form, setForm] = useState({
    name: reference.name ?? "",
    ups: reference.ups ?? "",
    colours: reference.colours ?? "",
    sides: reference.sides ?? "",
    default_machine: reference.default_machine ?? "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [machines, setMachines] = useState([]);

  useEffect(() => {
    getMachines()
      .then(setMachines)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isEdit)
      getHistory(reference.id)
        .then(setHistory)
        .catch(() => {});
  }, [isEdit, reference.id]);

  // Escape closes the popup (unless a save is running).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    if (
      Number(form.ups) > 200 &&
      !window.confirm(`UP = ${form.ups} looks unusually high. Save anyway?`)
    ) {
      return;
    }
    setSaving(true);
    setErrors({});
    const payload = {
      ...form,
      ups: Number(form.ups),
      colours: Number(form.colours),
      sides: Number(form.sides),
    };
    try {
      const saved = isEdit
        ? await updateReference(reference.id, payload)
        : await createReference(payload);
      onSaved(saved);
    } catch (err) {
      setErrors(err.response?.data ?? { detail: "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (f) =>
    errors[f] && (
      <div className="field-error">{[].concat(errors[f]).join(" ")}</div>
    );

  return (
    // No click handler on the backdrop: a stray click must not throw away typing.
    <div className="modal-backdrop">
      <form className="modal" onSubmit={handleSubmit}>
        <h2>{isEdit ? "Edit reference" : "Add new reference"}</h2>
        {hint && <p className="edit-hint">{hint}</p>}
        {errors.detail && <div className="error">{errors.detail}</div>}

        <label>Reference</label>
        <input
          value={form.name}
          onChange={set("name")}
          readOnly={lockName}
          required
          autoFocus={!lockName}
        />
        {fieldError("name")}

        <div className="row">
          <div>
            <label>UPs</label>
            <input
              type="number"
              min="1"
              value={form.ups}
              onChange={set("ups")}
              required
              autoFocus={lockName}
            />
            {fieldError("ups")}
          </div>
          <div>
            <label>Colours</label>
            <input
              type="number"
              min="1"
              value={form.colours}
              onChange={set("colours")}
              required
            />
            {fieldError("colours")}
          </div>
          <div>
            <label>Sides</label>
            <input
              type="number"
              min="1"
              value={form.sides}
              onChange={set("sides")}
              required
            />
            {fieldError("sides")}
          </div>
        </div>

        <label>Machine</label>
        <select value={form.default_machine} onChange={set("default_machine")}>
          <option value="">Select machine</option>
          {machines.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {fieldError("default_machine")}

        {isEdit && history.length > 0 && (
          <div className="history">
            <h3>Recent changes</h3>
            {history.slice(0, 5).map((h, i) => (
              <div key={i} className="history-row">
                {new Date(h.changed_at).toLocaleString()} · {h.changed_by}:{" "}
                {h.changes.created
                  ? "created"
                  : Object.entries(h.changes)
                      .map(([k, [a, b]]) => `${k} ${a} → ${b}`)
                      .join(", ")}
              </div>
            ))}
          </div>
        )}

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
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
