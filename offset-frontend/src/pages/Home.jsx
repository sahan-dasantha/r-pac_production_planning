import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteBatch, listBatches, uploadBatch } from "../api/jobs";
import UploadPanel from "../Components/UploadPanel";
import { errorMessage } from "../utils/errors";
import { getSelectedBatch, saveSelectedBatch } from "../utils/selectedBatch";
import "./Home.css";

const plural = (n, word) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

// Today's date, e.g. "Thursday, 26 November 2026" (read from the computer's clock).
const todayText = () =>
  new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * The Home tab: upload Excel sheets, choose which sheet to work on, delete a
 * sheet. The planning itself happens on the "Plan orders" tab, which opens on
 * the sheet chosen here (the choice is remembered by utils/selectedBatch).
 */
export default function Home() {
  const navigate = useNavigate(); // moves to another tab

  // ---------- Today's date (changes by itself when midnight passes) ----------
  const [today, setToday] = useState(todayText);
  useEffect(() => {
    const timer = setInterval(() => setToday(todayText()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // ---------- Data ----------
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ---------- Upload ----------
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [problems, setProblems] = useState(null);
  const [uploadNote, setUploadNote] = useState("");
  const [deletingBatch, setDeletingBatch] = useState(false);

  // ---------- Load the sheets once ----------
  useEffect(() => {
    let cancelled = false;
    let timer;

    // If the server is not ready yet (or the first request fails), try again
    // a little later instead of staying empty until the next upload.
    function load(attempt) {
      listBatches()
        .then((list) => {
          if (cancelled) return;
          setBatches(list);
          // The sheet chosen last time (here or on Job plans), else the newest upload.
          const saved = getSelectedBatch();
          const start = list.find((b) => String(b.id) === saved) ?? list[0];
          setBatchId(start?.id ?? null);
          setLoadError("");
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLoadError("Could not load your data. Trying again...");
          timer = setTimeout(
            () => load(attempt + 1),
            Math.min(2000 * (attempt + 1), 10000),
          );
        });
    }
    load(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // ---------- Upload one or several Excel sheets ----------
  // `input` is one File or a list of Files. They are uploaded one after another,
  // in the order they were chosen (if the same SO number is in two sheets,
  // the sheet uploaded last keeps it).
  async function handleUpload(input) {
    const files = (Array.isArray(input) ? input : [input]).filter(Boolean);
    if (files.length === 0) return;

    setUploading(true);
    setUploadError("");
    setProblems(null);
    setUploadNote("");

    const notes = [];
    const failures = [];
    let firstProblems = null;
    let lastBatchId = null;

    for (const file of files) {
      try {
        const data = await uploadBatch(file);
        lastBatchId = data.batch.id;

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
        notes.push(note);
      } catch (err) {
        const body = err.response?.data;
        if (body?.errors && !firstProblems) {
          // The row-by-row problem list is shown for the first sheet that has one.
          firstProblems = {
            detail:
              files.length > 1 ? `${file.name}: ${body.detail}` : body.detail,
            total: body.error_count,
            errors: body.errors,
          };
        } else {
          failures.push(
            `${file.name}: ${body?.detail ?? errorMessage(err, "Upload failed")}`,
          );
        }
      }
    }

    try {
      setBatches(await listBatches());
    } catch {
      setLoadError(
        "The sheets were uploaded, but the list could not be refreshed.",
      );
    }
    // Select the last sheet that was uploaded; "Plan orders" opens on it.
    if (lastBatchId !== null) {
      setBatchId(lastBatchId);
      saveSelectedBatch(lastBatchId);
    }

    if (files.length > 1) {
      notes.unshift(`${notes.length} of ${files.length} sheets uploaded.`);
    }
    setUploadNote(notes.join(" "));
    setProblems(firstProblems);
    setUploadError(failures.join(" "));
    setUploading(false);
  }

  // ---------- The user picked another sheet in the drop-down ----------
  function handleBatchChange(value) {
    const id =
      value === "" || value === null || value === undefined
        ? null
        : Number(value);
    if (id === batchId) return;
    setBatchId(id);
    if (id !== null) saveSelectedBatch(id); // "Plan orders" follows this choice
    setUploadNote("");
    setUploadError("");
    setProblems(null);
  }

  // ---------- Delete the selected Excel sheet (batch) ----------
  async function handleDeleteBatch() {
    if (batchId === null || deletingBatch) return;

    const current = batches.find((b) => b.id === batchId);
    const label = current?.filename ?? current?.name ?? "this sheet";

    const ok = window.confirm(
      `Delete "${label}"? The sheet and its unplanned orders will be deleted. Saved job plans are kept. This cannot be undone.`,
    );
    if (!ok) return;

    setDeletingBatch(true);
    setUploadError("");
    setProblems(null);
    setUploadNote("");
    try {
      const res = await deleteBatch(batchId);
      const kept = res?.data?.kept_plans ?? 0;
      const list = await listBatches();
      setBatches(list);
      if (list.length > 0) {
        setBatchId(list[0].id); // the newest remaining sheet
        saveSelectedBatch(list[0].id);
      } else {
        setBatchId(null);
      }
      if (kept > 0) {
        setUploadNote(
          `Sheet deleted. ${plural(kept, "saved job plan")} kept: find ${kept === 1 ? "it" : "them"} on the Job plans tab under "Plans of deleted sheets".`,
        );
      }
    } catch (err) {
      setUploadError(errorMessage(err, "Could not delete the sheet"));
    } finally {
      setDeletingBatch(false);
    }
  }

  const current = batches.find((b) => b.id === batchId) ?? null;

  return (
    <div className="home">
      <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{today}</p>

      <UploadPanel
        batches={batches}
        batchId={batchId}
        onBatchChange={handleBatchChange}
        onUpload={handleUpload}
        uploading={uploading}
        onDelete={handleDeleteBatch}
        deleting={deletingBatch}
        error={uploadError}
        problems={problems}
        note={uploadNote}
      />

      {loadError && (
        <div className="error" role="alert" style={{ marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {/* The sheet that "Plan orders" will open, and how far it has got */}
      {current ? (
        <section className="sheet-summary" aria-label="Selected sheet">
          <div>
            <div className="detail-label">Sheet to plan</div>
            <div className="sheet-name">{current.filename}</div>
            <div className="hint">
              {current.planned.toLocaleString("en-US")} of{" "}
              {current.total.toLocaleString("en-US")} planned ·{" "}
              {current.pending.toLocaleString("en-US")} pending ·{" "}
              {current.skipped.toLocaleString("en-US")} skipped
            </div>
          </div>
          <button type="button" onClick={() => navigate("/plan")}>
            Plan orders
          </button>
        </section>
      ) : (
        !loading && (
          <div className="detail-placeholder">
            No sheet yet. Choose an Excel file above to begin.
          </div>
        )
      )}
    </div>
  );
}
