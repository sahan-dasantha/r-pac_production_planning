/**
 * Formats what the user types as DD/MM/YYYY.
 * Typing "25122026" becomes "25/12/2026".
 * Only digits are kept, so the user never has to type the slashes.
 */
export function formatDateInput(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 8); // max 8 digits: DDMMYYYY
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Converts "DD/MM/YYYY" into "YYYY-MM-DD" (the format the backend expects).
 * Returns null when the text is not a real calendar date,
 * so "31/02/2026" is rejected.
 */
export function parseDateInput(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (year < 2000 || year > 2100) return null; // catches typos like 2062

  // Build the date, then check that JavaScript did not "roll it over"
  // (31 Feb would silently become 3 March).
  const date = new Date(year, month - 1, day);
  const real =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  return real ? `${yyyy}-${mm}-${dd}` : null;
}
