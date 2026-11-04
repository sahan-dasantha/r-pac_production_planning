import { useEffect, useState } from "react";
import {
  createReference,
  updateReference,
  getHistory,
} from "../api/references";

const MACHINES = [
  "7 - K",
  "RANPATH",
  "SM - B",
  "SM - C",
  "FROM BULK",
  "SCREEN",
  "PRINT CARE",
  "GUILLOTINE",
];

export default function ReferenceModal({ reference, onClose, onSaved }) {
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

  useEffect(() => {
    if (isEdit)
      getHistory(reference.id)
        .then(setHistory)
        .catch(() => {});
  }, [isEdit, reference.id]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
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
      isEdit
        ? await updateReference(reference.id, payload)
        : await createReference(payload);
      onSaved();
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
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{isEdit ? "Edit reference" : "Add new reference"}</h2>
        {errors.detail && <div className="error">{errors.detail}</div>}

        <label>Reference</label>
        <input value={form.name} onChange={set("name")} required autoFocus />
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

        <label>Default machine</label>
        <input
          list="machines"
          value={form.default_machine}
          onChange={set("default_machine")}
        />
        <datalist id="machines">
          {MACHINES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

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
          <button type="button" className="secondary" onClick={onClose}>
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
