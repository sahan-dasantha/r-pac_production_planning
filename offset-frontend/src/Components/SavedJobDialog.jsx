import { useEffect, useId, useRef } from "react";

/**
 * The "Do you want to add another job?" popup.
 *
 * Props:
 *   job   - the job the backend just saved (used for the short summary)
 *   onYes - called when the user wants to add another job
 *   onNo  - called when the user is finished
 *
 * It has no close button and ignores Escape and clicks outside on purpose:
 * the user must answer Yes or No, so the form is never left half-reset.
 */
export default function SavedJobDialog({ job, onYes, onNo }) {
  const yesRef = useRef(null);
  const noRef = useRef(null);
  const titleId = useId(); // ids let screen readers announce the dialog
  const textId = useId();

  // Put the cursor on "Yes" when the popup opens (it is the common answer).
  useEffect(() => {
    yesRef.current?.focus();
  }, []);

  // Keep Tab inside the popup: from the last button it wraps to the first,
  // and Shift+Tab from the first goes to the last.
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const first = yesRef.current;
    const last = noRef.current;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    // Dark layer over the page. It has no onClick, so clicking it does nothing.
    <div className="modal-backdrop">
      <div
        className="modal saved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>Job saved</h2>

        {/* Short summary so the user can see what was just saved */}
        <p id={textId} className="saved-summary">
          <span className="saved-ref">{job.reference_name}</span>
          <br />
          Total clicks: {job.total_clicks.toLocaleString("en-US")}
        </p>

        <p className="saved-question">Do you want to add another job?</p>

        <div className="actions">
          <button
            type="button"
            className="secondary"
            ref={noRef}
            onClick={onNo}
          >
            No
          </button>
          <button type="button" ref={yesRef} onClick={onYes}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
