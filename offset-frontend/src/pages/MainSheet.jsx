import { useEffect, useState } from "react";
import { searchReferences } from "../api/references";
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
            <th>Machine</th>
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
              <td>{r.default_machine}</td>
              <td>
                {new Date(r.updated_at).toLocaleDateString()}
                {r.updated_by ? ` · ${r.updated_by}` : ""}
              </td>
              <td>
                <button className="secondary" onClick={() => setEditing(r)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
          {!loading && data.results.length === 0 && (
            <tr>
              <td colSpan="7" className="empty">
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
