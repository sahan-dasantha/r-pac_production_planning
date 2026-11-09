import { useEffect, useId, useRef } from "react";
import { isoToDisplay } from "../utils/dates";

/**
 * "Delete this job?" confirmation popup.
 * Props:
 *   job       - the job about to be deleted
 *   busy      - true while the delete request is running
 *   error     - error text to show (empty when fine)
 *   onCancel  - user changed their mind
 *   onConfirm - user confirmed
 */
export default function ConfirmDeleteDialog({
  job,
  busy,
  error,
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);
  const deleteRef = useRef(null);
  const titleId = useId();
  const textId = useId();

  // Focus starts on Cancel, so pressing Enter by accident does NOT delete.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Escape = Cancel.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Keep Tab inside the popup (it wraps between the two buttons).
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const first = cancelRef.current;
    const last = deleteRef.current;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal saved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>Delete this job?</h2>

        <p id={textId} className="delete-summary">
          <span className="saved-ref">{job.reference_name}</span>
          <br />
          {isoToDisplay(job.date)} · Quantity{" "}
          {job.quantity.toLocaleString("en-US")} · {job.machine}
        </p>
        <p className="edit-hint">
          This removes it from the Job plans table and the Excel download. The
          deletion is recorded in the log.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="actions">
          <button
            type="button"
            className="secondary"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            ref={deleteRef}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
