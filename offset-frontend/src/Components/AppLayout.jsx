import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AccountSettings from "./AccountSettings";
import "../pages/Dashboard.css";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef(null);

  // While the menu is open: a click outside it, or Escape, closes it.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openSettings() {
    setMenuOpen(false);
    setSettingsOpen(true);
  }

  return (
    <div className="dash">
      <header>
        <h1>Offset Planner</h1>

        <div className="menu-wrap" ref={menuRef}>
          <span className="who">{user.username}</span>
          {/* The three-line icon is drawn with CSS (.bars), no image needed */}
          <button
            type="button"
            className="menu-btn"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="bars" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div className="menu" role="menu">
              <div className="menu-user">Signed in as {user.username}</div>
              <button type="button" role="menuitem" onClick={openSettings}>
                Account settings
              </button>
              <button type="button" role="menuitem" onClick={logout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="tabs">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/job-plans">Job plans</NavLink>
        <NavLink to="/main-sheet">Main sheet</NavLink>
      </nav>

      <Outlet />

      {settingsOpen && (
        <AccountSettings onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
