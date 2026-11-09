import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteJob, downloadJobsExcel, listJobs } from "../api/jobs";
import ConfirmDeleteDialog from "../Components/ConfirmDeleteDialog"; // NEW
import JobEditModal from "../Components/JobEditModal"; // NEW
import { isoToDisplay, todayISO } from "../utils/dates";
import { errorMessage } from "../utils/errors"; // NEW
import "./JobPlans.css";

// 1563 -> "1,563"
const fmt = (n) => n.toLocaleString("en-US");

export default function JobPlans() {
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

  // NEW: edit / delete state
  const [reload, setReload] = useState(0); // change it to re-fetch the list
  const [editing, setEditing] = useState(null); // the job open in the edit popup
  const [deleting, setDeleting] = useState(null); // the job in the delete popup
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [flash, setFlash] = useState(""); // "Job updated." message

  // ---------- Load the jobs whenever the page number changes ----------
  useEffect(() => {
    let cancelled = false; // ignore a late answer if the user already moved on
    console.log("JOBS fetch start:", { page, reload }); // DEBUG
    setLoading(true);

    listJobs(page)
      .then((d) => {
        console.log(
          "JOBS fetch result:",
          d.results.map((j) => [j.id, j.quantity]),
        ); // DEBUG
        if (!cancelled) {
          setData(d);
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the jobs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, reload]);

  // NEW: hide the green message after 4 seconds
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  // ---------- after the edit popup saved successfully ----------
  function handleEdited(updated) {
    console.log("handleEdited got:", updated); // DEBUG
    // 1. Replace that one row right away, so the table changes instantly.
    setData((d) => ({
      ...d,
      results: d.results.map((j) => (j.id === updated.id ? updated : j)),
    }));
    setEditing(null);
    setFlash("Job updated.");

    // 2. Also fetch the list again, so the table matches the database exactly.
    setReload((n) => n + 1);
  }
  // ---------- NEW: the user confirmed the delete ----------
  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteJob(deleting.id);
    } catch (err) {
      // 404 means someone else already deleted it: the goal is reached anyway.
      if (err.response?.status !== 404) {
        setDeleteError(errorMessage(err, "Could not delete the job"));
        setDeleteBusy(false);
        return; // keep the popup open so the user can retry
      }
    }
    setDeleteBusy(false);
    setDeleting(null);
    setFlash("Job deleted.");

    // If that was the only job on this page, step back one page.
    if (data.results.length === 1 && page > 1) setPage(page - 1);
    else setReload((n) => n + 1);
  }

  // ---------- Download the Excel file ----------
  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      // 1. Ask the backend for the file (the login token is attached for us).
      const blob = await downloadJobsExcel();

      // 2. Turn the file into a temporary link and click it,
      //    which makes the browser save the file.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `job-plans-${todayISO()}.xlsx`;
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

  const noJobs = !loading && !error && data.count === 0;

  return (
    <>
      {/* Title, job count and the download button */}
      <div className="page-head">
        <div>
          <h2>Job plans</h2>
          <p className="page-sub">
            {loading && data.count === 0
              ? "Loading..."
              : `${data.count} saved ${data.count === 1 ? "job" : "jobs"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading || data.count === 0}
        >
          {downloading ? "Preparing..." : "Download Excel"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {flash && (
        <div className="flash" role="status">
          {flash}
        </div>
      )}

      {/* Empty state: nothing has been saved yet */}
      {noJobs && (
        <div className="empty-jobs">
          No jobs saved yet. <Link to="/">Add the first job on Home.</Link>
        </div>
      )}

      {/* The table (scrolls sideways on small screens) */}
      {data.results.length > 0 && (
        <div className="table-scroll">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th className="num">UPs</th>
                <th className="num">Colours</th>
                <th className="num">Sides</th>
                <th className="num">Quantity</th>
                <th>Machine</th>
                <th className="num">Impressions</th>
                <th className="num">Total impressions</th>
                <th className="num">Total clicks</th>
                <th>Saved by</th>
                <th></th>
                {/* NEW: buttons column */}
              </tr>
            </thead>
            <tbody>
              {data.results.map((job) => (
                <tr key={job.id}>
                  <td>{isoToDisplay(job.date)}</td>
                  <td className="ref">{job.reference_name}</td>
                  <td className="num">{fmt(job.ups)}</td>
                  <td className="num">{fmt(job.colours)}</td>
                  <td className="num">{fmt(job.sides)}</td>
                  <td className="num">{fmt(job.quantity)}</td>
                  <td>{job.machine}</td>
                  <td className="num">{fmt(job.impressions)}</td>
                  <td className="num">{fmt(job.total_impressions)}</td>
                  <td className="num total">{fmt(job.total_clicks)}</td>
                  {/* Hovering shows exactly when the job was saved */}
                  <td title={new Date(job.created_at).toLocaleString()}>
                    {job.created_by}
                  </td>
                  {/* NEW: Edit and Delete buttons for this row */}
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
                        setDeleteError("");
                        setDeleting(job);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paging (20 jobs per page, set by PAGE_SIZE in the backend settings) */}
      {data.count > 0 && (
        <div className="pager">
          <button
            className="secondary"
            disabled={!data.previous || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>{loading ? "Loading..." : `Page ${page}`}</span>
          <button
            className="secondary"
            disabled={!data.next || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      {/* NEW: the two popups */}
      {editing && (
        <JobEditModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          job={deleting}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}
