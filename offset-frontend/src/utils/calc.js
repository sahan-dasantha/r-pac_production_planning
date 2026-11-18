import { api } from "../api/auth";

// GET /api/me/ -> { username, first_name, last_name, email }
export const getMe = () => api.get("/me/").then((r) => r.data);

// PATCH /api/me/ -> change any of those four fields
export const updateMe = (data) => api.patch("/me/", data).then((r) => r.data);

// POST /api/me/change-password/
export const changePassword = (current_password, new_password) =>
  api
    .post("/me/change-password/", { current_password, new_password })
    .then((r) => r.data);

export const MAX_DB_INT = 2147483647;
export const isValidUps = (v) => Number.isFinite(Number(v));

export function calculate(quantity, ups, sides, colours) {
  // Convert first, so numbers that arrive as text ("23000") still work.
  const q = Number(quantity);
  const u = Number(ups);
  const s = Number(sides);
  const c = Number(colours);

  if (
    !Number.isInteger(q) ||
    q < 1 ||
    !isValidUps(u) ||
    !Number.isInteger(s) ||
    !Number.isInteger(c)
  ) {
    // TEMPORARY: shows in the browser Console which value was refused.
    console.log("calculate refused:", { quantity, ups, sides, colours });
    return null;
  }

  // (q + u - 1) / u rounded down is the same as ROUNDUP(q / u)
  const impressions = Math.floor((q + u - 1) / u);
  const totalImpressions = impressions * s;
  const totalClicks = totalImpressions * c;
  return { impressions, totalImpressions, totalClicks };
} // placeholder, replace with the real logic
