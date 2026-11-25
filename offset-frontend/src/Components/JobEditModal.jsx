import { useEffect, useState } from "react";
import { updateJob } from "../api/jobs";
import { getMachines } from "../api/references";

/**
 * Edit ALL the details of one job plan.
 *
 * Props:
 *   job      - the row from the Job plans table
 *   onClose  - user cancelled
 *   onSaved  - called with the saved job
 */

// One label + input + error message. (Outside the modal so typing never loses focus.)
function Field({ label, error, hint, children }) {
  return (
    <div>
      <label>{label}</label>
      {children}
      {hint && !error && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>{hint}</div>
      )}
      {error && <div className="field-error">{[].concat(error).join(" ")}</div>}
    </div>
  );
}

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 12,
};

// The same maths as the server: impressions = quantity / UPs (rounded),
// total impressions = impressions x sides, total clicks = that x colours.
function calculate(f) {
  const q = Number(f.quantity);
  const u = Number(f.ups);
  const s = Number(f.sides);
  const c = Number(f.colours);
  if (!(q >= 1 && u >= 1 && s >= 1 && c >= 1)) return null;
  const impressions = Math.floor((2 * q + u) / (2 * u));
  const totalImpressions = impressions * s;
  return {
    impressions,
    totalImpressions,
    totalClicks: totalImpressions * c,
    balance: f.fg === "" || f.fg === null ? "" : q - Number(f.fg),
  };
}

const fmt = (n) =>
  n === "" || n === null ? "" : Number(n).toLocaleString("en-US");

export default function JobEditModal({ job, onClose, onSaved }) {
  const [form, setForm] = useState({
    current_stage: job.current_stage ?? "",
    docket_stage: job.docket_stage ?? "",
    so_number: job.so_number ?? "",
    order_type: job.order_type ?? "",
    quantity: job.quantity ?? "",
    fg: job.fg ?? "",
    noc: job.noc ?? 0,
    reference_name: job.reference_name ?? "",
    customer: job.customer ?? "",
    order_place_date: job.order_place_date ?? "",
    value: job.value ?? "",
    ups: job.ups ?? "",
    colours: job.colours ?? "",
    sides: job.sides ?? "",
    machine: job.machine ?? "",
    hold_status: job.hold_status ?? "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [machines, setMachines] = useState([]);

  useEffect(() => {
    getMachines()
      .then(setMachines)
      .catch(() => {});
  }, []);

  // Escape closes the popup (unless a save is running).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // A text/number input bound to one field, with its error message.
  const input = (name, label, props = {}, hint) => (
    <Field label={label} error={errors[name]} hint={hint}>
      <input value={form[name]} onChange={set(name)} {...props} />
    </Field>
  );

  const calc = calculate(form);
  // The machine list; keeps the job's current machine even if it is not in the list.
  const machineOptions = machines.includes(form.machine)
    ? machines
    : [form.machine, ...machines].filter(Boolean);

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    const payload = {
      current_stage: form.current_stage,
      docket_stage: form.docket_stage,
      so_number: form.so_number,
      order_type: form.order_type,
      quantity: Number(form.quantity),
      fg: form.fg === "" ? null : Number(form.fg),
      noc: form.noc === "" ? 0 : Number(form.noc),
      reference_name: form.reference_name,
      customer: form.customer,
      order_place_date: form.order_place_date || null,
      value: form.value === "" ? 0 : Number(form.value),
      ups: Number(form.ups),
      colours: Number(form.colours),
      sides: Number(form.sides),
      machine: form.machine,
      hold_status: form.hold_status,
    };
    try {
      const saved = await updateJob(job.id, payload);
      onSaved(saved);
    } catch (err) {
      setErrors(err.response?.data ?? { detail: "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    // No click handler on the backdrop: a stray click must not throw away typing.
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={handleSubmit}
        style={{
          width: "min(900px, 95vw)",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <h2>Edit job plan</h2>
        <p className="edit-hint">
          Order details are shared: a change to them is seen in every sheet that
          contains this order. Calculated values update by themselves.
        </p>
        {errors.detail && <div className="error">{errors.detail}</div>}
        {errors.non_field_errors && (
          <div className="error">
            {[].concat(errors.non_field_errors).join(" ")}
          </div>
        )}

        <h3>Order</h3>
        <div style={grid}>
          {input("so_number", "SO Number", { required: true, autoFocus: true })}
          {input("order_type", "Order Type", { required: true })}
          {input("customer", "Customer", { required: true })}
          {input("order_place_date", "Order Place", { type: "date" })}
          {input("current_stage", "Current Stage")}
          {input("docket_stage", "Docket Stage")}
          <Field label="Hold/Unhold" error={errors.hold_status}>
            <input
              list="hold-options"
              value={form.hold_status}
              onChange={set("hold_status")}
            />
            <datalist id="hold-options">
              <option value="Hold" />
              <option value="Unhold" />
            </datalist>
          </Field>
          {input("noc", "NOC", { type: "number", min: "0" })}
          {input("value", "Value", { type: "number", min: "0", step: "0.01" })}
        </div>

        <h3>Plan</h3>
        <div style={grid}>
          {input(
            "reference_name",
            "References",
            { required: true },
            "Must already exist in the Main sheet.",
          )}
          <Field label="Machine" error={errors.machine}>
            <select value={form.machine} onChange={set("machine")} required>
              <option value="">Select machine</option>
              {machineOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          {input("quantity", "Quantity", {
            type: "number",
            min: "1",
            required: true,
          })}
          {input("fg", "FG", { type: "number", min: "0" })}
          {input("ups", "UP Plan", {
            type: "number",
            min: "1",
            required: true,
          })}
          {input("colours", "No of Colours", {
            type: "number",
            min: "1",
            required: true,
          })}
          {input("sides", "No of Sides", {
            type: "number",
            min: "1",
            required: true,
          })}
        </div>

        <h3>Calculated (updates by itself)</h3>
        <div style={grid}>
          <Field label="Balance">
            <input readOnly value={calc ? fmt(calc.balance) : ""} />
          </Field>
          <Field label="Impression">
            <input readOnly value={calc ? fmt(calc.impressions) : ""} />
          </Field>
          <Field label="Total Impression">
            <input readOnly value={calc ? fmt(calc.totalImpressions) : ""} />
          </Field>
          <Field label="Total Clicks">
            <input readOnly value={calc ? fmt(calc.totalClicks) : ""} />
          </Field>
          <Field label="Last updated">
            <input readOnly value={new Date(job.updated_at).toLocaleString()} />
          </Field>
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
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
