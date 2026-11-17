import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteJob,
  downloadJobsExcel,
  listBatches,
  listJobs,
} from "../api/jobs";
import ConfirmDeleteDialog from "../Components/ConfirmDeleteDialog";
import JobEditModal from "../Components/JobEditModal";
import { isoToDisplay } from "../utils/dates";
import { errorMessage } from "../utils/errors";
import "./JobPlans.css";

const PAGE_SIZE = 50; // the same number as JobPagination in the backend

// 1563 -> "1,563"
const fmt = (n) => n.toLocaleString("en-US");

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

  // ---------- Load the batch list once; start on the newest batch ----------
  useEffect(() => {
    listBatches()
      .then((list) => {
        setBatches(list);
        setBatchId(list[0] ? String(list[0].id) : "all");
      })
      .catch(() => {
        setError("Could not load the batches");
        setBatchId("all");
      });
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
          batch: batchId === "all" ? undefined : batchId,
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
    setFlash("Job plan deleted. The order is pending again on the Home tab.");

    // If that was the only job on this page, step back one page.
    if (data.results.length === 1 && page > 1) setPage(page - 1);
    else setReload((n) => n + 1);
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
            setPage(1);
          }}
          disabled={batchId === null}
        >
          <option value="all">All batches</option>
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

      {/* The table (scrolls sideways on small screens) */}
      {data.results.length > 0 && (
        <div className="table-scroll">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>SO number</th>
                <th>Reference</th>
                <th>Order type</th>
                <th>Customer</th>
                <th>Order place date</th>
                <th className="num">Changes</th>
                <th className="num">Value</th>
                <th className="num">Quantity</th>
                <th>Machine</th>
                <th className="num">UPs</th>
                <th className="num">Colours</th>
                <th className="num">Sides</th>
                <th className="num">Impressions</th>
                <th className="num">Total impressions</th>
                <th className="num">Total clicks</th>
                <th>Planned by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((job) => (
                <tr key={job.id}>
                  <td>{job.so_number}</td>
                  <td className="ref">{job.reference_name}</td>
                  <td>{job.order_type}</td>
                  <td>{job.customer}</td>
                  <td>
                    {job.order_place_date
                      ? isoToDisplay(job.order_place_date)
                      : ""}
                  </td>
                  <td className="num">{fmt(job.noc)}</td>
                  <td className="num">
                    {job.value.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="num">{fmt(job.quantity)}</td>
                  <td>{job.machine}</td>
                  <td className="num">{fmt(job.ups)}</td>
                  <td className="num">{fmt(job.colours)}</td>
                  <td className="num">{fmt(job.sides)}</td>
                  <td className="num">{fmt(job.impressions)}</td>
                  <td className="num">{fmt(job.total_impressions)}</td>
                  <td className="num total">{fmt(job.total_clicks)}</td>
                  {/* Hovering shows exactly when the job was planned */}
                  <td title={new Date(job.created_at).toLocaleString()}>
                    {job.created_by}
                  </td>
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
    </>
  );
}
