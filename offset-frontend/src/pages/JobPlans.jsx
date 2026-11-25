import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteJob,
  downloadJobsExcel,
  listBatches,
  listJobs,
  restoreJobs,
} from "../api/jobs";
import ConfirmDeleteDialog from "../Components/ConfirmDeleteDialog";
import JobEditModal from "../Components/JobEditModal";
import { isoToDisplay } from "../utils/dates";
import { errorMessage } from "../utils/errors";
import { getSelectedBatch, saveSelectedBatch } from "../utils/selectedBatch";
import "./JobPlans.css";

const PAGE_SIZE = 50; // the same number as JobPagination in the backend

// 1563 -> "1,563"
const fmt = (n) => n.toLocaleString("en-US");

// Same as fmt, but shows an empty cell when the value does not exist (yet).
// Used for FG and Balance, which are empty when the sheet has no FG column.
const fmtOrBlank = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString("en-US");

// Today's date, e.g. "Monday, 23 November 2026" (read from the computer's clock).
const todayText = () =>
  new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// A job is on hold when the sheet says "Hold" in the Hold/Unhold column.
const isHeld = (job) => (job.hold_status ?? "").trim().toLowerCase() === "hold";

export default function JobPlans() {
  // ---------- Which jobs to show ----------
  const [batches, setBatches] = useState([]);
  // null = still loading the batch list, "all" = every batch, otherwise a batch id
  const [batchId, setBatchId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  // ---------- Edit / delete state ----------
  const [reload, setReload] = useState(0); // change it to re-fetch the list
  const [editing, setEditing] = useState(null); // the job open in the edit popup
  const [deleting, setDeleting] = useState(null); // the job in the delete popup
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [flash, setFlash] = useState(""); // "Job plan updated." message
  // ---------- Today's date (changes by itself when midnight passes) ----------
  const [today, setToday] = useState(todayText);
  useEffect(() => {
    const timer = setInterval(() => setToday(todayText()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // ---------- Undo the last delete ----------
  const [undo, setUndo] = useState(null); // { ids: [deleted job ids], message }
  const [undoBusy, setUndoBusy] = useState(false);

  // ---------- Multi-select + bulk delete ----------
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // ticked job ids
  const [bulkOpen, setBulkOpen] = useState(false); // the "delete selected" popup
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  // ---------- Load the batch list once; start where the planner stopped ----------
  useEffect(() => {
    let cancelled = false;
    let timer;

    // If the server is not ready yet (or the first request fails), try again
    // a little later instead of staying empty.
    function load(attempt) {
      listBatches()
        .then((list) => {
          if (cancelled) return;
          setBatches(list);
          setError("");
          // The sheet chosen on the Home tab (or here, last time); else the newest.
          const saved = getSelectedBatch();
          const match = list.find((b) => String(b.id) === saved);
          setBatchId(
            saved === "all" || saved === "none"
              ? saved
              : match
                ? String(match.id)
                : list[0]
                  ? String(list[0].id)
                  : "all",
          );
        })
        .catch(() => {
          if (cancelled) return;
          setError("Could not load the batches. Trying again...");
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

  // ---------- Load the jobs whenever batch, search or page changes ----------
  useEffect(() => {
    if (batchId === null) return; // the batch list has not arrived yet
    let cancelled = false; // ignore a late answer if the user already moved on
    setLoading(true);

    // Wait a moment while the planner is typing in the search box.
    const timer = setTimeout(
      () => {
        listJobs({
          page,
          batch: batchId === "all" ? undefined : batchId, // a sheet id, or "none"
          search: searchText.trim(),
        })
          .then((d) => {
            if (!cancelled) {
              setData(d);
              setError("");
            }
          })
          .catch(() => {
            if (!cancelled) setError("Could not load the job plans");
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      searchText ? 300 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [batchId, searchText, page, reload]);

  // Ticks only make sense for the rows on screen: clear them when the list changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [batchId, searchText, page]);

  // Hide the green message after 4 seconds.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  // ---------- after the edit popup saved successfully ----------
  function handleEdited(updated) {
    // Replace that one row right away, then fetch again so it matches the database.
    setData((d) => ({
      ...d,
      results: d.results.map((j) => (j.id === updated.id ? updated : j)),
    }));
    setEditing(null);
    setFlash("Job plan updated.");
    setReload((n) => n + 1);
  }

  // ---------- the user confirmed the delete ----------
  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteJob(deleting.id);
    } catch (err) {
      // 404 means someone else already deleted it: the goal is reached anyway.
      if (err.response?.status !== 404) {
        setDeleteError(errorMessage(err, "Could not delete the job plan"));
        setDeleteBusy(false);
        return; // keep the popup open so the user can retry
      }
    }
    setDeleteBusy(false);
    setDeleting(null);
    setUndo({
      ids: [deleting.id],
      message: "Job plan deleted. The order is pending again on the Home tab.",
    });

    // If that was the only job on this page, step back one page.
    if (data.results.length === 1 && page > 1) setPage(page - 1);
    else setReload((n) => n + 1);
  }

  // ---------- Tick rows and delete them together ----------
  // Only rows that are on the page right now count as selected.
  const selectedJobs = data.results.filter((j) => selectedIds.has(j.id));
  const allSelected =
    data.results.length > 0 && selectedJobs.length === data.results.length;

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      allSelected ? new Set() : new Set(data.results.map((j) => j.id)),
    );
  }

  async function confirmBulkDelete() {
    const ids = selectedJobs.map((j) => j.id);
    setBulkBusy(true);
    setBulkError("");

    // One after another (not all at once), so the database is never overloaded.
    const failed = [];
    for (const id of ids) {
      try {
        await deleteJob(id);
      } catch (err) {
        // 404 = already deleted by someone else: the goal is reached anyway.
        if (err.response?.status !== 404) failed.push(id);
      }
    }
    setBulkBusy(false);

    const deletedIds = ids.filter((id) => !failed.includes(id));
    if (deletedIds.length > 0) {
      setUndo({
        ids: deletedIds,
        message: `${deletedIds.length} job plan${deletedIds.length === 1 ? "" : "s"} deleted. The orders are pending again on the Home tab.`,
      });
    }

    if (failed.length > 0) {
      // Keep the popup open with only the rows that could not be deleted.
      setSelectedIds(new Set(failed));
      setBulkError(
        `${failed.length} of ${ids.length} job plans could not be deleted. You can try again.`,
      );
      setReload((n) => n + 1);
      return;
    }

    setBulkOpen(false);
    setSelectedIds(new Set());
    // If the whole page was deleted, step back one page.
    if (ids.length === data.results.length && page > 1) setPage(page - 1);
    else setReload((n) => n + 1);
  }

  // ---------- Undo: bring the deleted job plans back ----------
  async function handleUndo() {
    if (!undo || undoBusy) return;
    setUndoBusy(true);
    setError("");
    try {
      const res = await restoreJobs(undo.ids);
      const n = res.restored.length;
      const skipped = res.skipped.length;
      setUndo(null);
      setFlash(
        skipped > 0
          ? `${n} restored, ${skipped} could not be restored: ${res.skipped[0].reason}`
          : `${n} job plan${n === 1 ? "" : "s"} restored.`,
      );
      setReload((x) => x + 1);
    } catch (err) {
      setError(errorMessage(err, "Could not restore the job plans"));
    } finally {
      setUndoBusy(false);
    }
  }

  // ---------- Download the Excel file for the chosen batch ----------
  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      // 1. Ask the backend for the file (the login token is attached for us).
      const { blob, filename } = await downloadJobsExcel(
        batchId === "all" ? null : batchId,
      );

      // 2. Turn the file into a temporary link and click it,
      //    which makes the browser save the file.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();

      // 3. Free the temporary link a moment later.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not download the file. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const pages = Math.max(1, Math.ceil(data.count / PAGE_SIZE));
  const searching = searchText.trim() !== "";
  const noJobs = !loading && !error && data.count === 0;

  return (
    <>
      {/* Title, job count and the download button */}
      <div className="page-head">
        <div>
          <h2>Job plans</h2>
          <p className="page-sub" style={{ fontWeight: 600 }}>
            {today}
          </p>
          <p className="page-sub">
            {loading && data.count === 0
              ? "Loading..."
              : `${fmt(data.count)} planned ${data.count === 1 ? "job" : "jobs"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading || data.count === 0 || searching}
          title={
            searching
              ? "Clear the search to download the whole batch"
              : undefined
          }
        >
          {downloading ? "Preparing..." : "Download Excel"}
        </button>
      </div>

      {/* Batch picker and search box */}
      <div className="toolbar">
        <select
          aria-label="Planning batch"
          value={batchId ?? ""}
          onChange={(e) => {
            setBatchId(e.target.value);
            saveSelectedBatch(e.target.value); // the Home tab follows this choice
            setPage(1);
          }}
          disabled={batchId === null}
        >
          <option value="all">All batches</option>
          <option value="none">Plans of deleted sheets</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.filename} · {new Date(b.uploaded_at).toLocaleDateString()}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search SO, reference, customer or machine..."
          aria-label="Search job plans"
          autoComplete="off"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {error && <div className="error">{error}</div>}
      {flash && (
        <div className="flash" role="status">
          {flash}
        </div>
      )}
      {undo && (
        <div
          className="flash"
          role="status"
          style={{ display: "flex", alignItems: "center", gap: 12 }}
        >
          <span>{undo.message}</span>
          <button
            type="button"
            className="secondary"
            onClick={handleUndo}
            disabled={undoBusy}
          >
            {undoBusy ? "Restoring..." : "Undo"}
          </button>
          <button
            type="button"
            className="secondary"
            aria-label="Dismiss"
            onClick={() => setUndo(null)}
            disabled={undoBusy}
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty state */}
      {noJobs && (
        <div className="empty-jobs">
          {searching ? (
            "No job plans match your search."
          ) : (
            <>
              No job plans in this selection yet.{" "}
              <Link to="/">Plan the orders on Home.</Link>
            </>
          )}
        </div>
      )}

      {/* Shown while at least one row is ticked */}
      {selectedJobs.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            padding: "10px 14px",
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: "#fff",
            border: "1px solid #e6d9a8",
            borderRadius: 8,
          }}
        >
          <strong>{fmt(selectedJobs.length)} selected</strong>
          <button
            type="button"
            className="secondary danger"
            onClick={() => {
              setBulkError("");
              setBulkOpen(true);
            }}
          >
            Delete selected
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* The table (scrolls sideways on small screens) */}
      {data.results.length > 0 && (
        <div className="table-scroll">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          selectedJobs.length > 0 && !allSelected;
                    }}
                    onChange={toggleAll}
                    style={{
                      width: 18,
                      height: 18,
                      padding: 0,
                      margin: 0,
                      cursor: "pointer",
                    }}
                  />
                </th>
                <th>Last updated date</th>
                <th>Current Stage</th>
                <th>Docket Stage</th>
                <th>SO Number</th>
                <th>Order Type</th>
                <th className="num">Quantity</th>
                <th className="num">FG</th>
                <th className="num">Balance</th>
                <th className="num">NOC</th>
                <th>References</th>
                <th>Customer</th>
                <th>Order Place</th>
                <th className="num">Value</th>
                <th className="num">Impression</th>
                <th className="num">Total Impression</th>
                <th className="num">UP Plan</th>
                <th className="num">No of Colours</th>
                <th className="num">No of Sides</th>
                <th className="num">Total Clicks</th>
                <th>Machine</th>
                <th>Hold/Unhold</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((job) => (
                <tr
                  key={job.id}
                  className={isHeld(job) ? "on-hold" : undefined}
                  style={
                    selectedIds.has(job.id)
                      ? { background: "#fdf3cf" }
                      : undefined
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${job.so_number}`}
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleRow(job.id)}
                      style={{
                        width: 18,
                        height: 18,
                        padding: 0,
                        margin: 0,
                        cursor: "pointer",
                      }}
                    />
                  </td>
                  {/* Changes whenever the plan is saved: edited, held/unheld, restored.
                      Hovering shows the exact date and time. */}
                  <td title={new Date(job.updated_at).toLocaleString()}>
                    {job.updated_at
                      ? new Date(job.updated_at).toLocaleDateString("en-GB")
                      : ""}
                  </td>
                  <td>{job.current_stage ?? ""}</td>
                  <td>{job.docket_stage ?? ""}</td>
                  {/* Hovering the SO number shows who planned it and when */}
                  <td
                    title={`Planned by ${job.created_by} on ${new Date(
                      job.created_at,
                    ).toLocaleString()}`}
                  >
                    {job.so_number}
                  </td>
                  <td>{job.order_type}</td>
                  <td className="num">{fmt(job.quantity)}</td>
                  <td className="num">{fmtOrBlank(job.fg)}</td>
                  <td className="num">{fmtOrBlank(job.balance)}</td>
                  <td className="num">{fmt(job.noc)}</td>
                  <td className="ref">{job.reference_name}</td>
                  <td>{job.customer}</td>
                  <td>
                    {job.order_place_date
                      ? isoToDisplay(job.order_place_date)
                      : ""}
                  </td>
                  <td className="num">
                    {job.value.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="num">{fmt(job.impressions)}</td>
                  <td className="num">{fmt(job.total_impressions)}</td>
                  <td className="num">{fmt(job.ups)}</td>
                  <td className="num">{fmt(job.colours)}</td>
                  <td className="num">{fmt(job.sides)}</td>
                  <td className="num total">{fmt(job.total_clicks)}</td>
                  <td>{job.machine}</td>
                  <td>{job.hold_status ?? ""}</td>
                  <td className="row-actions">
                    <button
                      className="secondary"
                      onClick={() => setEditing(job)}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary danger-text"
                      onClick={() => {
                        if (
                          selectedIds.has(job.id) &&
                          selectedJobs.length > 1
                        ) {
                          // this row is ticked together with others: delete all ticked rows
                          setBulkError("");
                          setBulkOpen(true);
                        } else {
                          setDeleteError("");
                          setDeleting(job);
                        }
                      }}
                    >
                      {selectedIds.has(job.id) && selectedJobs.length > 1
                        ? `Delete (${fmt(selectedJobs.length)})`
                        : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paging (50 job plans per page) */}
      {data.count > 0 && (
        <div className="pager">
          <button
            className="secondary"
            disabled={!data.previous || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>{loading ? "Loading..." : `Page ${page} of ${pages}`}</span>
          <button
            className="secondary"
            disabled={!data.next || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* The two popups */}
      {editing && (
        <JobEditModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          title="Delete this job plan?"
          note="It disappears from the Job plans table and the Excel download. The order becomes pending again, so it can be planned again. The deletion is recorded in the log."
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        >
          <span className="saved-ref">{deleting.so_number}</span>
          <br />
          {deleting.reference_name} · {deleting.machine} · Total clicks{" "}
          {fmt(deleting.total_clicks)}
        </ConfirmDeleteDialog>
      )}
      {bulkOpen && selectedJobs.length > 0 && (
        <ConfirmDeleteDialog
          title={`Delete ${fmt(selectedJobs.length)} job plan${selectedJobs.length === 1 ? "" : "s"}?`}
          note="They disappear from the Job plans table and the Excel download. The orders become pending again, so they can be planned again. Every deletion is recorded in the log."
          busy={bulkBusy}
          error={bulkError}
          onCancel={() => setBulkOpen(false)}
          onConfirm={confirmBulkDelete}
        >
          {selectedJobs.slice(0, 5).map((j) => (
            <div key={j.id}>
              <span className="saved-ref">{j.so_number}</span> ·{" "}
              {j.reference_name}
            </div>
          ))}
          {selectedJobs.length > 5 && (
            <div>and {fmt(selectedJobs.length - 5)} more</div>
          )}
        </ConfirmDeleteDialog>
      )}
    </>
  );
}
