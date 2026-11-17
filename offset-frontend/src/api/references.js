import { api } from "./auth";

export const searchReferences = (search, page = 1) =>
  api.get("/references/", { params: { search, page } }).then((r) => r.data);

export const createReference = (data) =>
  api.post("/references/", data).then((r) => r.data);

export const updateReference = (id, data) =>
  api.patch(`/references/${id}/`, data).then((r) => r.data);

// NEW: DELETE /api/references/<id>/ -> 409 with a message when saved job
// plans still use the reference.
export const deleteReference = (id) => api.delete(`/references/${id}/`);

export const getHistory = (id) =>
  api.get(`/references/${id}/history/`).then((r) => r.data);

export const getMachines = () =>
  api.get("/references/machines/").then((r) => r.data);
