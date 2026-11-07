// The largest number the database column can hold (PostgreSQL/SQLite int).
// A very large quantity could push "total clicks" past this, so we check it.
export const MAX_DB_INT = 2147483647;

/**
 * The same formulas as the backend (and your Excel sheet):
 *   impressions       = ROUNDUP(quantity / ups)
 *   total impressions = impressions * sides
 *   total clicks      = total impressions * colours
 *
 * The page shows these as a live preview. The backend recalculates them
 * when saving, so the saved numbers can never be wrong.
 */
export function calculate(quantity, ups, sides, colours) {
  // (q + u - 1) / u rounded down is the same as ROUNDUP(q / u)
  const impressions = Math.floor((quantity + ups - 1) / ups);
  const totalImpressions = impressions * sides;
  const totalClicks = totalImpressions * colours;
  return { impressions, totalImpressions, totalClicks };
}
