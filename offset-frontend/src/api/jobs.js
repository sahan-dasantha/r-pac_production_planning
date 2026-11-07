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

// GET /api/jobs/?page=N -> one page of saved jobs, newest first.
// The response looks like { count, next, previous, results: [...] }
export const listJobs = (page = 1) =>
  api.get("/jobs/", { params: { page } }).then((r) => r.data);

// GET /api/jobs/export/ -> the Excel file with ALL jobs.
// responseType "blob" tells axios this is a file, not JSON text.
export const downloadJobsExcel = () =>
  api.get("/jobs/export/", { responseType: "blob" }).then((r) => r.data);
