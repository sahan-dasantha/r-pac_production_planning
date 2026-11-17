import { useEffect, useState } from "react";
import { changePassword, getMe, updateMe } from "../api/account";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../utils/errors";

// Turns a backend error into { field: "message" }. Anything that is not a
// field error becomes { detail: "message" } and is shown at the top.
function toErrors(err, fallback) {
  const data = err.response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = [].concat(value).join(" ");
    }
    return out;
  }
  return { detail: errorMessage(err, fallback) };
}

const FieldError = ({ errors, name }) =>
  errors[name] ? <div className="field-error">{errors[name]}</div> : null;

/**
 * Popup opened from the three-line menu. Two separate forms:
 *   1. Profile: username, name, email
 *   2. Password: current, new, confirm
 * Clicking outside does not close it, so typing is never lost by accident.
 */
export default function AccountSettings({ onClose }) {
  const { updateUser } = useAuth();

  // ---------- Profile ----------
  const [profile, setProfile] = useState(null); // null while loading
  const [profileErrors, setProfileErrors] = useState({});
  const [profileMsg, setProfileMsg] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  // ---------- Password ----------
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErrors, setPwErrors] = useState({});
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const busy = profileBusy || pwBusy;

  useEffect(() => {
    getMe()
      .then(setProfile)
      .catch((err) =>
        setProfileErrors(toErrors(err, "Could not load your profile")),
      );
  }, []);

  // Escape closes the popup (unless a save is running).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const setField = (field) => (e) =>
    setProfile({ ...profile, [field]: e.target.value });

  async function saveProfile(e) {
    e.preventDefault();
    if (profileBusy || !profile) return;
    setProfileBusy(true);
    setProfileErrors({});
    setProfileMsg("");
    try {
      const saved = await updateMe(profile);
      setProfile(saved);
      updateUser({ username: saved.username }); // header shows the new name
      setProfileMsg("Profile saved.");
    } catch (err) {
      setProfileErrors(toErrors(err, "Could not save your profile"));
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (pwBusy) return;
    setPwMsg("");
    if (next !== confirm) {
      setPwErrors({ confirm: "The two new passwords do not match." });
      return;
    }
    setPwBusy(true);
    setPwErrors({});
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwMsg("Password changed.");
    } catch (err) {
      setPwErrors(toErrors(err, "Could not change the password"));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <h2>Account settings</h2>

        {/* ===== Profile ===== */}
        <form onSubmit={saveProfile} noValidate>
          <h3>Login details</h3>
          {profileErrors.detail && (
            <div className="error">{profileErrors.detail}</div>
          )}

          {!profile && !profileErrors.detail && (
            <p className="edit-hint">Loading...</p>
          )}

          {profile && (
            <>
              <label htmlFor="acc-username">Username</label>
              <input
                id="acc-username"
                value={profile.username}
                onChange={setField("username")}
                autoComplete="username"
                required
              />
              <FieldError errors={profileErrors} name="username" />

              <div className="row two">
                <div>
                  <label htmlFor="acc-first">First name</label>
                  <input
                    id="acc-first"
                    value={profile.first_name}
                    onChange={setField("first_name")}
                    autoComplete="given-name"
                  />
                  <FieldError errors={profileErrors} name="first_name" />
                </div>
                <div>
                  <label htmlFor="acc-last">Last name</label>
                  <input
                    id="acc-last"
                    value={profile.last_name}
                    onChange={setField("last_name")}
                    autoComplete="family-name"
                  />
                  <FieldError errors={profileErrors} name="last_name" />
                </div>
              </div>

              <label htmlFor="acc-email">Email</label>
              <input
                id="acc-email"
                type="email"
                value={profile.email}
                onChange={setField("email")}
                autoComplete="email"
              />
              <FieldError errors={profileErrors} name="email" />

              {profileMsg && (
                <div className="flash" role="status">
                  {profileMsg}
                </div>
              )}
              <div className="actions">
                <button type="submit" disabled={profileBusy}>
                  {profileBusy ? "Saving..." : "Save profile"}
                </button>
              </div>
            </>
          )}
        </form>

        {/* ===== Password ===== */}
        <form className="settings-section" onSubmit={savePassword} noValidate>
          <h3>Change password</h3>
          {pwErrors.detail && <div className="error">{pwErrors.detail}</div>}

          <label htmlFor="acc-current">Current password</label>
          <input
            id="acc-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <FieldError errors={pwErrors} name="current_password" />

          <label htmlFor="acc-new">New password</label>
          <input
            id="acc-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          <FieldError errors={pwErrors} name="new_password" />

          <label htmlFor="acc-confirm">Confirm new password</label>
          <input
            id="acc-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          <FieldError errors={pwErrors} name="confirm" />

          {pwMsg && (
            <div className="flash" role="status">
              {pwMsg}
            </div>
          )}
          <div className="actions">
            <button
              type="submit"
              disabled={pwBusy || !current || !next || !confirm}
            >
              {pwBusy ? "Saving..." : "Change password"}
            </button>
          </div>
        </form>

        <div className="actions settings-close">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
