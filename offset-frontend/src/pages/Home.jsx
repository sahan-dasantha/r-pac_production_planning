import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMachines } from "../api/references";
import { createJob, uploadReferences } from "../api/jobs";
import ReferenceSelect from "../Components/ReferenceSelect";
import SavedJobDialog from "../Components/SavedJobDialog";
import { calculate, MAX_DB_INT } from "../utils/calc";
import { formatDateInput, parseDateInput } from "../utils/dates";
import { errorMessage } from "../utils/errors";
import "./Home.css";

// 1563 -> "1,563"   (null/undefined -> "")
const fmt = (n) => (n == null ? "" : n.toLocaleString("en-US"));

// A label, the input(s) inside it, and an optional red error line.
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

// One box in the dark "Job breakdown" panel.
//   wide     = spans the full row (used for the reference name)
//   accent   = gold highlight (used for Total clicks)
//   action   = NEW: optional button shown next to the value (used for Edit / Done)
//   children = NEW: optional content that replaces the value (used for the ups input)
function Tile({ label, value, note, wide, accent, action, children }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`tile${wide ? " wide" : ""}${accent ? " accent" : ""}`}>
      <div className="tile-label">{label}</div>
      <div
        className="tile-value-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        {children ? (
          children
        ) : (
          <div className={`tile-value${empty ? " dim" : ""}`}>{empty ? "-" : value}</div>
        )}
        {action}
      </div>
      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();   // moves to another tab
  const homeRef = useRef(null);     // lets us focus the dropdown after "Yes"

  // ---------- Reference list (from the uploaded Excel sheet) ----------
  const [upload, setUpload] = useState(null);      // info about the newest upload
  const [refs, setRefs] = useState([]);            // the dropdown options
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef(null);                  // the hidden file picker

  const [machines, setMachines] = useState([]);    // machine dropdown options

  // ---------- The form ----------
  const [selected, setSelected] = useState(null);  // chosen reference option
  const [dateText, setDateText] = useState("");    // "DD/MM/YYYY" as typed
  const [quantityText, setQuantityText] = useState("");
  // Number of ups. Pre-filled from the Main sheet; the user can change it
  // for this job only by pressing Edit in the Job breakdown panel.
  // The Main sheet is never changed.
  const [upsText, setUpsText] = useState("");
  const [editingUps, setEditingUps] = useState(false); // is the ups tile in edit mode?
  const upsInput = useRef(null);                       // so we can focus the ups input
  const [machine, setMachine] = useState("");
  const [attempted, setAttempted] = useState(false); // has Save been clicked?
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedJob, setSavedJob] = useState(null);  // set after saving -> popup opens

  // ---------- Load data once when the page opens ----------
  useEffect(() => {
    // Start with a fresh upload area whenever Home mounts.
    setUpload(null);
    setRefs([]);
    setSelected(null);
    setDateText("");
    setQuantityText("");
    setUpsText("");
    setEditingUps(false);
    setMachine("");
    setAttempted(false);
    setUploadError("");

    // Load only the machine dropdown.
    getMachines().then(setMachines).catch(() => {});

    setLoadingRefs(false);
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
      setUpsText("");
      setEditingUps(false);
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
    setSaveError("");

    // Pre-fill ups from the Main sheet and leave edit mode.
    setUpsText(
      option.in_main_sheet && option.ups != null ? String(option.ups) : ""
    );
    setEditingUps(false);

    // Pre-select the reference's usual machine; the user can still change it.
    const usual = option.default_machine;
    setMachine(usual && machines.includes(usual) ? usual : "");
  }

  // Edit / Done button next to the ups value in the Job breakdown panel
  function toggleEditUps() {
    if (editingUps) {
      finishEditUps();
    } else {
      setEditingUps(true); // show the input and put the cursor in it
      setTimeout(() => {
        upsInput.current?.focus();
        upsInput.current?.select();
      }, 0);
    }
  }

  // Leave edit mode. If the box was left empty or 0, go back to the Main sheet value.
  function finishEditUps() {
    const typed = upsText ? parseInt(upsText, 10) : 0;
    if (typed < 1 && selected?.ups != null) {
      setUpsText(String(selected.ups));
    }
    setEditingUps(false);
  }

  // ---------- Values worked out from the form ----------
  const inMain = Boolean(selected?.in_main_sheet);

  // ups is whatever is in the ups box.
  const ups = inMain ? (upsText ? parseInt(upsText, 10) : 0) : null;

  const colours = inMain ? selected.colours : null;
  const sides = inMain ? selected.sides : null;

  const quantity = quantityText ? parseInt(quantityText, 10) : 0;
  const dateISO = parseDateInput(dateText);

  // Has the user changed ups away from the Main sheet value?
  const upsChanged =
    inMain && selected.ups != null && ups !== selected.ups;

  // Live preview of the three calculated values.
  // ups must be 1 or more, which also avoids dividing by zero.
  const result =
    inMain && quantity >= 1 && ups >= 1
      ? calculate(quantity, ups, sides, colours)
      : null;
  const tooLarge = result !== null && result.totalClicks > MAX_DB_INT;

  // What is wrong with the form right now
  const problems = {};
  if (!selected) problems.reference = "Select a reference";
  if (!dateISO) problems.date = "Enter a valid date as DD/MM/YYYY";
  if (inMain && ups < 1) problems.ups = "Enter a number of ups of 1 or more";
  if (quantity < 1) problems.quantity = "Enter a quantity of 1 or more";
  else if (tooLarge) problems.quantity = "This quantity is too large";
  if (!machine) problems.machine = "Select a machine";
  // Red messages appear only after the user has clicked Save once.
  const show = (field) => (attempted ? problems[field] : undefined);

  // The note under the ups value in the Job breakdown panel
  let upsNote;
  if (show("ups")) {
    upsNote = show("ups");
  } else if (editingUps) {
    upsNote = "Type the ups, then press Done";
  } else if (upsChanged) {
    upsNote = `Edited for this job (Main sheet: ${fmt(selected.ups)})`;
  } else {
    upsNote = "From the Main sheet";
  }

  // ---------- The status line next to the Save button ----------
  let statusText;
  let statusTone; // "idle" (grey dot), "ready" (green dot), "warn" (red dot)
  if (!selected) {
    statusText = "Select a reference to begin";
    statusTone = "idle";
  } else if (!inMain) {
    statusText = "Add this reference in the Main sheet tab first";
    statusTone = "warn";
  } else if (Object.keys(problems).length > 0) {
    statusText = "Complete the date, ups, quantity and machine";
    statusTone = "idle";
  } else {
    statusText = "Ready to save this job";
    statusTone = "ready";
  }

  // ---------- Save ----------
  async function handleSave() {
    // Ignore clicks while a save is running or the popup is open.
    if (saving || savedJob) return;

    setAttempted(true);
    setSaveError("");
    if (!inMain || Object.keys(problems).length > 0) return; // show the errors

    setSaving(true);
    try {
      const job = await createJob({
        reference: selected.reference_id, // id from the Main sheet data
        date: dateISO,                    // YYYY-MM-DD
        quantity,
        ups,                              // the ups used for this job (may differ from the Main sheet)
        machine,
      });
      setSavedJob(job); // opens the "Add another job?" popup
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save the job"));
    } finally {
      setSaving(false);
    }
  }

  // Empty every field. The uploaded reference list is kept.
  function clearForm() {
    setSelected(null);
    setDateText("");
    setQuantityText("");
    setUpsText("");
    setEditingUps(false);
    setMachine("");
    setAttempted(false);
    setSaveError("");
    setSavedJob(null); // this also closes the popup
  }

  // Popup "Yes": clear the form and put the cursor in the reference dropdown.
  function handleYes() {
    clearForm();
    window.scrollTo({ top: 0 });
    setTimeout(() => {
      homeRef.current?.querySelector('[role="combobox"]')?.focus();
    }, 0);
  }

  // Popup "No": the user is done, so open the Job plans tab.
  function handleNo() {
    navigate("/job-plans");
  }

  // ---------- Page ----------
  return (
    <div className="home" ref={homeRef}>
      {/* One form around both columns, so Enter in a field also saves */}
      <form
        className="home-grid"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        noValidate
      >
        {/* ===== LEFT: what the user enters ===== */}
        <section className="entry-card" aria-labelledby="entry-title">
          <div className="card-head">
            <h2 id="entry-title">Job details</h2>
            <span className="card-tag">Input required</span>
          </div>

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
            label="Reference"
            error={
              selected && !inMain
                ? "This reference is not in the Main sheet. Add it in the Main sheet tab first."
                : show("reference")
            }
          >
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

            {/* Upload button and a one-line note about the sheet in use */}
            <div className="upload-row">
              <span className="upload-note">
                {loadingRefs
                  ? "Loading..."
                  : upload
                  ? `${upload.filename}: ${upload.total} references`
                  : "No Excel sheet uploaded yet. It needs a column headed 'References'."}
                {upload && upload.missing > 0 && (
                  <span className="warn"> ({upload.missing} not in the Main sheet)</span>
                )}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                hidden
                onChange={handleFile}
              />
              <button
                type="button"
                className="secondary small"
                onClick={() => fileInput.current.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload sheet"}
              </button>
            </div>
            {uploadError && <div className="error">{uploadError}</div>}
          </Field>

          {/* The "Number of ups" field was moved into the Job breakdown panel. */}

          <Field label="Machine" htmlFor="job-machine" error={show("machine")}>
            <select
              id="job-machine"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
            >
              <option value="">Select machine</option>
              {machines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {selected?.default_machine && (
              <div className="hint">Pre-selected from the reference. You can change it.</div>
            )}
          </Field>

          <Field label="Quantity" htmlFor="job-quantity" error={show("quantity")}>
            <div className="with-suffix">
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
              <span>units</span>
            </div>
          </Field>

          <div className="entry-foot">
            <button type="button" className="link-btn" onClick={clearForm}>
              Clear inputs
            </button>
            <span className="hint">Results update as you type</span>
          </div>
        </section>

        {/* ===== RIGHT: the breakdown and the Save bar ===== */}
        <div className="home-right">
          <section className="breakdown" aria-label="Job breakdown">
            <div className="card-head dark">
              <div>
                <h2>Job breakdown</h2>
                <p>Values from the Main sheet, and calculated from your quantity</p>
              </div>
              <span className="pill">Auto computed</span>
            </div>

            {/* Row 1: the reference, then its three values */}
            <div className="tiles">
              <Tile
                wide
                label="Reference"
                value={selected?.name}
                note={selected && !inMain ? "Not in the Main sheet" : undefined}
              />

              {/* NEW: Number of ups with the Edit / Done button next to the value */}
              <Tile
                label="Number of ups"
                value={fmt(ups || null)}
                note={upsNote}
                action={
                  inMain ? (
                    <button
                      type="button"
                      onClick={toggleEditUps}
                      style={{
                        padding: "4px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        border: "1px solid currentColor",
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {editingUps ? "Done" : "Edit"}
                    </button>
                  ) : null
                }
              >
                {editingUps ? (
                  <input
                    ref={upsInput}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="Number of ups"
                    value={upsText}
                    // keep digits only, max 4 characters
                    onChange={(e) =>
                      setUpsText(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    // Enter finishes editing instead of saving the whole job
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        finishEditUps();
                      }
                    }}
                    style={{
                      width: "90px",
                      padding: "4px 8px",
                      fontSize: "inherit",
                      fontWeight: "inherit",
                      color: "#111",
                      background: "#fff",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                    }}
                  />
                ) : null}
              </Tile>

              <Tile label="Number of colours" value={fmt(colours)} note="From the Main sheet" />
              <Tile label="Number of sides" value={fmt(sides)} note="From the Main sheet" />
            </div>

            {/* Row 2: the three calculated results */}
            <div className="tiles results">
              <Tile
                label="Impressions"
                value={fmt(result?.impressions)}
                note="Quantity ÷ ups, rounded up"
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

          {saveError && <div className="error">{saveError}</div>}

          <div className="save-bar">
            <span className={`status ${statusTone}`} role="status">{statusText}</span>
            {/* Disabled while saving, or when the reference is not in the Main sheet */}
            <button type="submit" disabled={saving || (selected && !inMain)}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>

      {/* The popup appears as soon as the backend confirms the job was saved */}
      {savedJob && (
        <SavedJobDialog job={savedJob} onYes={handleYes} onNo={handleNo} />
      )}
    </div>
  );
}