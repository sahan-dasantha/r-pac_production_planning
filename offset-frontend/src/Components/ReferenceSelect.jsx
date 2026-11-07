import { useEffect, useId, useMemo, useRef, useState } from "react";

// Show at most this many options at once (keeps big lists fast).
const MAX_SHOWN = 100;

/**
 * Props:
 *   options     - list of { name, in_main_sheet, ... } from the uploaded sheet
 *   value       - the selected option (or null)
 *   onChange    - called with the option the user picks
 *   disabled    - true while there is nothing to choose from
 *   placeholder - text shown when nothing is selected
 */
export default function ReferenceSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder,
}) {
  const [open, setOpen] = useState(false); // is the list visible?
  const [query, setQuery] = useState(""); // what the user typed
  const [active, setActive] = useState(0); // highlighted row (keyboard)
  const boxRef = useRef(null);
  const listId = useId(); // unique id for accessibility

  // Filter: every typed word must appear in the name (any order, any case).
  // "mini mb 3" finds "FG_LV_H1 22-T3-MINI MB_S112444_MB".
  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) =>
      words.every((w) => o.name.toLowerCase().includes(w)),
    );
  }, [options, query]);
  const shown = filtered.slice(0, MAX_SHOWN);

  // Close the list when the user clicks anywhere outside this component.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Keep the highlighted row visible when using the arrow keys.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  function pick(option) {
    onChange(option);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && shown[active]) pick(shown[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "Tab") {
      setOpen(false); // let focus move on normally
    }
  }

  return (
    <div className="combo" ref={boxRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label="Select reference"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        // While open show what is being typed; otherwise show the choice.
        value={open ? query : (value?.name ?? "")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="combo-caret" aria-hidden="true" />

      {open && !disabled && (
        <div className="combo-pop">
          <ul id={listId} role="listbox">
            {shown.map((o, i) => (
              <li
                key={o.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={value?.name === o.name}
                className={`combo-option${i === active ? " active" : ""}`}
                // onMouseDown (not onClick) so the input does not lose focus first
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{o.name}</span>
                {/* Names that exist in the uploaded sheet but not in the Main sheet */}
                {!o.in_main_sheet && (
                  <span className="combo-tag">(not in Main sheet)</span>
                )}
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <div className="combo-empty">No matching reference</div>
          )}
          {filtered.length > MAX_SHOWN && (
            <div className="combo-more">
              Showing {MAX_SHOWN} of {filtered.length}. Type more to narrow the
              list.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
