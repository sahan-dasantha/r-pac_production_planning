import { api } from "./auth";

// ---------------------------------------------------------------- Batches
// POST /api/batches/upload/ -> upload one .xlsx sheet = one batch.
// Success: { batch, created, overwritten, plans_reset, missing_references }
// Failure (400): { detail, errors: [{row, column, message}], error_count }
// Files must be sent as FormData; axios sets the multipart header itself.
export const uploadBatch = (file) => {
  const form = new FormData();
  form.append("file", file); // the field name must be exactly "file"
  return api.post("/batches/upload/", form).then((r) => r.data);
};

// GET /api/batches/ -> every batch, newest first, with its counts:
// { id, filename, uploaded_at, uploaded_by, total, planned, skipped, pending }
export const listBatches = () => api.get("/batches/").then((r) => r.data);

// DELETE /api/batches/<id>/ -> remove one uploaded sheet (batch).
// Its orders (and their plans) are removed with it. Returns nothing (204).
export const deleteBatch = (id) => api.delete(`/batches/${id}/`);

// GET /api/batches/<id>/orders/ -> EVERY order of the batch in one list.
// Each order carries its Main sheet values (reference, or null if missing)
// and its saved plan (job, or null).
export const listBatchOrders = (batchId) =>
  api.get(`/batches/${batchId}/orders/`).then((r) => r.data);

// ----------------------------------------------------------------- Orders
// Each of these returns the updated order, in the same shape as the list.

// POST /api/orders/<id>/plan/ -> the Next button: save machine + UPs.
// Calling it again for an already planned order re-plans it.
export const planOrder = (id, { machine, ups }) =>
  api.post(`/orders/${id}/plan/`, { machine, ups }).then((r) => r.data);

// POST /api/orders/<id>/skip/ -> cannot be planned now
export const skipOrder = (id) =>
  api.post(`/orders/${id}/skip/`).then((r) => r.data);

// POST /api/orders/<id>/reset/ -> back to pending (for example to un-skip)
export const resetOrder = (id) =>
  api.post(`/orders/${id}/reset/`).then((r) => r.data);

// -------------------------------------------------------------- Job plans
// GET /api/jobs/?page=N&batch=ID&search=TEXT -> one page (50) of job plans.
// { count, next, previous, results: [...] }. Leave batch empty for all batches.
export const listJobs = ({ page = 1, batch, search } = {}) => {
  const params = { page };
  if (batch) params.batch = batch;
  if (search) params.search = search;
  return api.get("/jobs/", { params }).then((r) => r.data);
};

// PATCH /api/jobs/<id>/ -> change machine and/or ups (nothing else is editable)
export const updateJob = (id, data) =>
  api.patch(`/jobs/${id}/`, data).then((r) => r.data);

// DELETE /api/jobs/<id>/ -> the order goes back to pending
export const deleteJob = (id) => api.delete(`/jobs/${id}/`);

// POST /api/jobs/restore/ {ids} -> Undo: bring deleted job plans back.
// Returns { restored: [new job ids], skipped: [{ id, reason }] }.
export const restoreJobs = (ids) =>
  api.post("/jobs/restore/", { ids }).then((r) => r.data);

// GET /api/jobs/export/?batch=ID -> the Excel file (all batches without an id).
// Returns { blob, filename }; the server chooses the file name.
export const downloadJobsExcel = async (batchId) => {
  const res = await api.get("/jobs/export/", {
    params: batchId ? { batch: batchId } : {},
    responseType: "blob", // tells axios this is a file, not JSON text
  });
  const match = /filename="?([^";]+)"?/.exec(
    res.headers["content-disposition"] || "",
  );
  return { blob: res.data, filename: match ? match[1] : "job-plans.xlsx" };
};
