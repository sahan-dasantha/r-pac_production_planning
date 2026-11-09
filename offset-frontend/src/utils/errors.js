// Turns a backend error response into one readable sentence.
export function errorMessage(err, fallback) {
  // No response at all = the server is down, or the browser blocked it.
  if (!err.response) return "Cannot reach the server";

  const data = err.response.data;
  const status = err.response.status;

  // The server replied, but with no JSON message (e.g. an HTML error page).
  if (!data || typeof data === "string") return `${fallback} (error ${status})`;

  if (data.detail) return data.detail; // e.g. "Not found."
  // Field errors look like { quantity: ["..."] }
  const text = Object.entries(data)
    .map(([field, msgs]) => `${field}: ${[].concat(msgs).join(" ")}`)
    .join(" ");
  return text || `${fallback} (error ${status})`;
}
