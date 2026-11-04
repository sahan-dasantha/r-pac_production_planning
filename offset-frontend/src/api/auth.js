import axios from "axios";

export const api = axios.create({
  baseURL: "http://127.0.0.1:8000/api",
});

// Attach the token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes("/token/")) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

export async function loginRequest(username, password) {
  try {
    const { data } = await api.post("/token/", { username, password });
    return { token: data.access, user: { username } };
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("Invalid username or password");
    }
    throw new Error("Cannot reach the server");
  }
}
