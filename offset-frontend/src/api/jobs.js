import { api } from "./auth";

// GET /api/reference-upload/  -> the current dropdown list (newest upload)
export const getUploadedReferences = () =>
  api.get("/reference-upload/").then((r) => r.data);

// POST /api/reference-upload/ -> upload a new .xlsx sheet.
// Files must be sent as FormData. Axios sets the correct
// "multipart/form-data" header (with its boundary) by itself.
export const uploadReferences = (file) => {
  const form = new FormData();
  form.append("file", file); // the field name must be exactly "file"
  return api.post("/reference-upload/", form).then((r) => r.data);
};

// POST /api/jobs/ -> save one job.
// We send only: reference id, date (YYYY-MM-DD), quantity, machine.
// The backend copies ups/colours/sides and does the calculations itself.
export const createJob = (data) => api.post("/jobs/", data).then((r) => r.data);
