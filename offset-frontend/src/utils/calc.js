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
export const calculate = () => ({}); // placeholder, replace with the real logic
