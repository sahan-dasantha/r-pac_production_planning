import { useEffect, useRef, useState } from "react";
import { getMachines } from "../api/references";
import {
  createJob,
  getUploadedReferences,
  uploadReferences,
} from "../api/jobs";
import ReferenceSelect from "../Components/ReferenceSelect";
import { calculate, MAX_DB_INT } from "../utils/calc";
import { formatDateInput, parseDateInput } from "../utils/dates";
import "./Home.css";

// Turns a backend error response into one readable sentence.
function errorMessage(err, fallback) {
  const data = err.response?.data;
  if (!data) return "Cannot reach the server"; // network problem
  if (typeof data === "string") return fallback; // unexpected HTML error page
  if (data.detail) return data.detail; // e.g. "Only .xlsx files..."
  // Field errors look like { quantity: ["..."] }
  const text = Object.entries(data)
    .map(([field, msgs]) => `${field}: ${[].concat(msgs).join(" ")}`)
    .join(" ");
  return text || fallback;
}

// Formats numbers with commas: 1563 -> "1,563"
const fmt = (n) => (n == null ? "" : n.toLocaleString("en-US"));

// A label with its content and an optional red error line underneath.
function Field({ label, htmlFor, error, children }) {
  return (
    <div className="field">
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <span className="label">{label}</span>
      )}
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

// A read-only value box. Shows "-" until there is something to show.
function ReadOnly({ value, result }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div
      className={`readonly${empty ? " empty" : ""}${result ? " result" : ""}`}
    >
      {empty ? "-" : value}
    </div>
  );
}

export default function Home() {
  // ---------- Reference list (from the uploaded Excel sheet) ----------
  const [upload, setUpload] = useState(null); // info about the newest upload
  const [refs, setRefs] = useState([]); // the dropdown options
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef(null); // the hidden file picker

  const [machines, setMachines] = useState([]); // machine dropdown options

  // ---------- The form ----------
  const [selected, setSelected] = useState(null); // chosen reference option
  const [dateText, setDateText] = useState(""); // "DD/MM/YYYY" as typed
  const [quantityText, setQuantityText] = useState("");
  const [machine, setMachine] = useState("");
  const [attempted, setAttempted] = useState(false); // has Save been clicked?
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedJob, setSavedJob] = useState(null); // Part 5 replaces this with a popup

  // ---------- Load data once when the page opens ----------
  useEffect(() => {
    getUploadedReferences()
      .then((d) => {
        setUpload(d.upload);
        setRefs(d.references);
      })
      .catch(() => setUploadError("Could not load the reference list"))
      .finally(() => setLoadingRefs(false));

    getMachines()
      .then(setMachines)
      .catch(() => {});
  }, []);

  // ---------- Upload an Excel sheet ----------
  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = ""; // allows choosing the same file again later
    if (!file) return;

    setUploading(true);
    setUploadError("");
    try {
      const data = await uploadReferences(file);
      setUpload(data.upload);
      setRefs(data.references);
      // The old selection may not exist in the new list, so clear it.
      setSelected(null);
      setMachine("");
    } catch (err) {
      setUploadError(errorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  // ---------- The user picks a reference ----------
  function handleSelect(option) {
    setSelected(option);
    setSavedJob(null);
    setSaveError("");
    // Pre-select the reference's usual machine; the user can still change it.
    const usual = option.default_machine;
    setMachine(usual && machines.includes(usual) ? usual : "");
  }

  // ---------- Values worked out from the form ----------
  const inMain = Boolean(selected?.in_main_sheet);
  const ups = inMain ? selected.ups : null;
  const colours = inMain ? selected.colours : null;
  const sides = inMain ? selected.sides : null;

  const quantity = quantityText ? parseInt(quantityText, 10) : 0;
  const dateISO = parseDateInput(dateText);

  // Live preview of the three calculated values
  const result =
    inMain && quantity >= 1 ? calculate(quantity, ups, sides, colours) : null;
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  // What is wrong with the form right now (shown after Save is clicked)
  const problems = {};
  if (!selected) problems.reference = "Select a reference";
  if (!dateISO) problems.date = "Enter a valid date as DD/MM/YYYY";
  if (quantity < 1) problems.quantity = "Enter a quantity of 1 or more";
  else if (tooLarge) problems.quantity = "This quantity is too large";
  if (!machine) problems.machine = "Select a machine";
  const show = (field) => (attempted ? problems[field] : undefined);

  // ---------- Save ----------
  async function handleSave() {
    setAttempted(true);
    setSaveError("");
    if (!inMain || Object.keys(problems).length > 0) return; // show the errors

    setSaving(true);
    try {
      const job = await createJob({
        reference: selected.reference_id, // id from the Main sheet data
        date: dateISO, // YYYY-MM-DD
        quantity,
        machine,
      });
      setSavedJob(job); // Part 5: open the "Add another job?" popup here
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save the job"));
    } finally {
      setSaving(false);
    }
  }

  // ---------- Page ----------
  return (
    <div className="home">
      {/* Top bar: Upload button + reference dropdown (as in the sketch) */}
      <div className="home-bar">
        <div>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            hidden
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileInput.current.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>

        <ReferenceSelect
          options={refs}
          value={selected}
          onChange={handleSelect}
          disabled={refs.length === 0}
          placeholder={
            loadingRefs
              ? "Loading references..."
              : refs.length === 0
                ? "Upload a sheet first"
                : "Select reference"
          }
        />
      </div>

      {/* One line telling the user which sheet is in use */}
      <p className="upload-note">
        {loadingRefs
          ? "Loading..."
          : upload
            ? `${upload.filename}: ${upload.total} references`
            : "No Excel sheet uploaded yet. It needs a column headed 'References'."}
        {upload && upload.missing > 0 && (
          <span className="warn">
            {" "}
            ({upload.missing} not in the Main sheet)
          </span>
        )}
      </p>

      {uploadError && <div className="error">{uploadError}</div>}
      {saveError && <div className="error">{saveError}</div>}
      {savedJob && (
        <div className="notice" role="status">
          Job saved. Total clicks: {fmt(savedJob.total_clicks)}.
        </div>
      )}

      {/* The form */}
      <form
        className="job-card"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        noValidate
      >
        {/* Left column: values that come from the Main sheet or are calculated */}
        <div className="job-col">
          <Field
            label="Reference"
            error={
              selected && !inMain
                ? "This reference is not in the Main sheet. Add it in the Main sheet tab first."
                : show("reference")
            }
          >
            <ReadOnly value={selected?.name} />
          </Field>
          <Field label="Number of ups">
            <ReadOnly value={fmt(ups)} />
          </Field>
          <Field label="Number of colours">
            <ReadOnly value={fmt(colours)} />
          </Field>
          <Field label="Number of sides">
            <ReadOnly value={fmt(sides)} />
          </Field>
          <Field label="Impressions">
            <ReadOnly value={fmt(result?.impressions)} result />
          </Field>
          <Field label="Total impressions">
            <ReadOnly value={fmt(result?.totalImpressions)} result />
          </Field>
          <Field label="Total clicks">
            <ReadOnly value={fmt(result?.totalClicks)} result />
          </Field>
        </div>

        {/* Right column: what the user types or chooses */}
        <div className="job-col">
          <Field label="Date" htmlFor="job-date" error={show("date")}>
            <input
              id="job-date"
              placeholder="DD/MM/YYYY"
              inputMode="numeric"
              autoComplete="off"
              value={dateText}
              onChange={(e) => setDateText(formatDateInput(e.target.value))}
            />
          </Field>

          <Field
            label="Quantity"
            htmlFor="job-quantity"
            error={show("quantity")}
          >
            <input
              id="job-quantity"
              inputMode="numeric"
              autoComplete="off"
              value={quantityText}
              // keep digits only, max 9 characters
              onChange={(e) =>
                setQuantityText(e.target.value.replace(/\D/g, "").slice(0, 9))
              }
            />
          </Field>

          <Field label="Machine" htmlFor="job-machine" error={show("machine")}>
            <select
              id="job-machine"
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
          </Field>

          <div className="job-actions">
            {/* Disabled while saving, or when the reference is not in the Main sheet */}
            <button type="submit" disabled={saving || (selected && !inMain)}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
