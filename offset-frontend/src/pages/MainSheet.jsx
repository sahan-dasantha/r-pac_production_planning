import { useEffect, useState } from "react";
import { searchReferences, deleteReference } from "../api/references";
import ReferenceModal from "../components/ReferenceModal";

export default function MainSheet() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = closed, {} = new
  const [deletingId, setDeletingId] = useState(null); // id of row being deleted
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const d = await searchReferences(query.trim(), page);
        if (!cancelled) {
          setData(d);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Could not load references");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, page, reload]);

  async function handleDelete(r) {
    const ok = window.confirm(
      `Delete reference "${r.name}"? This cannot be undone.`,
    );
    if (!ok) return;

    setDeletingId(r.id);
    try {
      await deleteReference(r.id);
      setError("");

      // If that was the last row on this page, go back one page
      if (data.results.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        setReload((n) => n + 1);
      }
    } catch {
      setError("Could not delete reference");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input
          placeholder="Search reference (e.g. MINI MB 3)..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          autoFocus
        />
        <button onClick={() => setEditing({})}>+ Add new reference</button>
      </div>

      {error && <div className="error">{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>UPs</th>
            <th>Colours</th>
            <th>Sides</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.ups}</td>
              <td>{r.colours}</td>
              <td>{r.sides}</td>
              <td>
                {new Date(r.updated_at).toLocaleDateString()}
                {r.updated_by ? ` · ${r.updated_by}` : ""}
              </td>
              <td>
                <button className="secondary" onClick={() => setEditing(r)}>
                  Edit
                </button>{" "}
                <button
                  className="secondary danger"
                  onClick={() => handleDelete(r)}
                  disabled={deletingId === r.id}
                >
                  {deletingId === r.id ? "Deleting..." : "Delete"}
                </button>
              </td>
            </tr>
          ))}
          {!loading && data.results.length === 0 && (
            <tr>
              <td colSpan="6" className="empty">
                No references found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pager">
        <button
          className="secondary"
          disabled={!data.previous}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          {loading ? "Loading..." : `${data.count} references · page ${page}`}
        </span>
        <button
          className="secondary"
          disabled={!data.next}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>

      {editing && (
        <ReferenceModal
          reference={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
