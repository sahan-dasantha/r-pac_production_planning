import { createContext, useContext, useState } from "react";
import { loginRequest } from "../api/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });

  async function login(username, password) {
    const data = await loginRequest(username, password);
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  // NEW: called after the planner edits their profile, so the header shows
  // the new username without logging in again.
  function updateUser(changes) {
    setUser((current) => {
      const next = { ...current, ...changes };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
