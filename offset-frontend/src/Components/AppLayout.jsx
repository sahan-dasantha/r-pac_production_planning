import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../pages/Dashboard.css";

export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="dash">
      <header>
        <h1>Offset Planner</h1>
        <div>
          <span>{user.username}</span>
          <button className="secondary" onClick={logout}>
            Log out
          </button>
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
    </div>
  );
}
