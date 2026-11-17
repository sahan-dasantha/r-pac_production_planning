import { useEffect, useId, useRef } from "react";

/**
 * A "Delete this ...?" confirmation popup, used by Job plans and Main sheet.
 *
 * Props:
 *   title     - e.g. "Delete this job plan?"
 *   children  - the summary of what is about to be deleted (shown in a box)
 *   note      - a small grey explanation under the summary
 *   busy      - true while the delete request is running
 *   error     - error text to show (empty when fine)
 *   onCancel  - user changed their mind
 *   onConfirm - user confirmed
 */
export default function ConfirmDeleteDialog({
  title,
  children,
  note,
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
        <h2 id={titleId}>{title}</h2>

        <p id={textId} className="delete-summary">
          {children}
        </p>
        {note && <p className="edit-hint">{note}</p>}

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
