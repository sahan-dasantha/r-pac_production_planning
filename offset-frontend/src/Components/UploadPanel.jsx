import { useRef } from "react";

const when = (iso) => new Date(iso).toLocaleDateString();

/**
 * The upload box at the top of the Home page.
 *
 * Props:
 *   batches, batchId, onBatchChange - the batch picker (one batch per upload)
 *   onUpload(files)                 - called with an ARRAY of the chosen files
 *   uploading                       - true while the uploads run
 *   onDelete, deleting              - the "Delete the Excel sheet" button
 *   error                           - a one-line error (wrong file type, server down...)
 *   problems                        - { total, detail, errors: [{row, column, message}] }
 *                                     when the sheet was read but rejected
 *   note                            - a one-line result after a successful upload
 */
export default function UploadPanel({
  batches,
  batchId,
  onBatchChange,
  onUpload,
  uploading,
  onDelete,
  deleting,
  error,
  problems,
  note,
}) {
  const fileInput = useRef(null); // the hidden file picker

  function handleFiles(e) {
    const files = Array.from(e.target.files); // every file that was chosen
    e.target.value = ""; // allows choosing the same files again later
    if (files.length > 0) onUpload(files);
  }

  return (
    <section className="upload-panel" aria-label="Upload sheet">
      <div className="upload-bar">
        <h2>Upload sheet</h2>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          multiple
          hidden
          onChange={handleFiles}
        />

        {/* "Choose Excel file" with the delete button right under it */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            onClick={() => fileInput.current.click()}
            disabled={uploading}
            title="You can select several Excel files at once"
          >
            {uploading ? "Uploading..." : "Choose Excel file"}
          </button>
          {onDelete && batchId !== null && (
            <button
              type="button"
              className="secondary danger"
              onClick={onDelete}
              disabled={deleting || uploading}
            >
              {deleting ? "Deleting..." : "Delete the Excel sheet"}
            </button>
          )}
        </div>

        <div className="upload-batch">
          <label htmlFor="batch-select">Planning batch</label>
          <select
            id="batch-select"
            value={batchId ?? ""}
            onChange={(e) => onBatchChange(Number(e.target.value))}
            disabled={batches.length === 0}
          >
            {batches.length === 0 && <option value="">No uploads yet</option>}
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.filename} · {when(b.uploaded_at)} · {b.total} orders
              </option>
            ))}
          </select>
        </div>
      </div>

      {note && <p className="upload-note">{note}</p>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {problems && (
        <div className="problems" role="alert">
          <div className="problems-head">
            {problems.detail}
            {problems.total > problems.errors.length &&
              ` Showing the first ${problems.errors.length}.`}
          </div>
          <div className="problems-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Column</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {problems.errors.map((p, i) => (
                  <tr key={i}>
                    <td>{p.row}</td>
                    <td>{p.column}</td>
                    <td>{p.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}