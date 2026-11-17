import { useEffect, useId, useRef } from "react";

/**
 * "Batch complete" popup: opens when no pending order is left.
 *
 * Props:
 *   planned, skipped - the final counts
 *   onStay           - stay on Home (to review or fix orders with Previous)
 *   onOpenPlans      - go to the Job plans tab
 */
export default function BatchCompleteDialog({
  planned,
  skipped,
  onStay,
  onOpenPlans,
}) {
  const stayRef = useRef(null);
  const plansRef = useRef(null);
  const titleId = useId();
  const textId = useId();

  // Put the cursor on "Open Job plans" (the usual next step).
  useEffect(() => {
    plansRef.current?.focus();
  }, []);

  // Escape = stay on this page.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onStay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);

  // Keep Tab inside the popup (it wraps between the two buttons).
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const first = stayRef.current;
    const last = plansRef.current;
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
        <h2 id={titleId}>Batch complete</h2>
        <p id={textId}>
          Every order in this batch has been dealt with:{" "}
          <strong>{planned.toLocaleString("en-US")} planned</strong>
          {skipped > 0 && <>, {skipped.toLocaleString("en-US")} skipped</>}.
        </p>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            ref={stayRef}
            onClick={onStay}
          >
            Stay here
          </button>
          <button type="button" ref={plansRef} onClick={onOpenPlans}>
            Open Job plans
          </button>
        </div>
      </div>
    </div>
  );
}
