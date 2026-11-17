import { useRef } from "react";

const when = (iso) => new Date(iso).toLocaleDateString();

/**
 * The upload box at the top of the Home page.
 *
 * Props:
 *   batches, batchId, onBatchChange - the batch picker (one batch per upload)
 *   onUpload(file)                  - called when a file has been chosen
 *   uploading                       - true while the upload runs
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
  error,
  problems,
  note,
}) {
  const fileInput = useRef(null); // the hidden file picker

  function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = ""; // allows choosing the same file again later
    if (file) onUpload(file);
  }

  return (
    <section className="upload-panel" aria-label="Upload sheet">
      <div className="upload-bar">
        <h2>Upload sheet</h2>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          hidden
          onChange={handleFile}
        />
        <button
          type="button"
          onClick={() => fileInput.current.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Choose Excel file"}
        </button>

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
