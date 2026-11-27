import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  api,
  type DbCheck,
  type DbConnectionBody,
  type DbStatus,
} from "../../api/client.js";
import { useSession } from "../../stores/session.js";

const SCHEMA_TEXT: Record<DbCheck["schema_state"], string> = {
  empty: "Empty database — Passman's tables will be created.",
  current: "Existing Passman database, schema up to date.",
  outdated: "Existing Passman database — it will be migrated to the latest schema.",
  unmanaged: "Contains tables Passman did not create.",
  unknown: "Schema state unknown.",
};

const EMPTY: DbConnectionBody = {
  host: "",
  port: 5432,
  database: "",
  username: "",
  password: "",
  sslmode: "prefer",
};

/**
 * Admin-only: point the server at a different PostgreSQL database.
 *
 * Rendered only when the API says the signed-in account is the configured
 * admin (GET /api/admin/database → 200); everyone else gets 403 and sees
 * nothing. The password lives only in component state and is cleared on
 * success. The previous database is never modified.
 */
export function ServerDatabaseSection() {
  const nav = useNavigate();
  const accessToken = useSession((s) => s.accessToken);
  const clear = useSession((s) => s.clear);

  const [status, setStatus] = useState<DbStatus | null>(null);
  const [form, setForm] = useState<DbConnectionBody>(EMPTY);
  const [check, setCheck] = useState<DbCheck | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"test" | "switch" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    api
      .adminDbStatus(accessToken)
      .then((s) => live && setStatus(s))
      .catch(() => {
        /* 403 for non-admins: render nothing */
      });
    return () => {
      live = false;
    };
  }, [accessToken]);

  if (!status || !accessToken) return null;
  const token = accessToken;

  function edit(patch: Partial<DbConnectionBody>) {
    setForm((f) => ({ ...f, ...patch }));
    setCheck(null); // any edit invalidates a previous successful test
    setAck(false);
    setError(null);
  }

  const filled = form.host && form.database && form.username && form.password;

  async function onTest() {
    setBusy("test");
    setError(null);
    try {
      setCheck(await api.adminDbTest(token, form));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSwitch() {
    setBusy("switch");
    setError(null);
    try {
      await api.adminDbSwitch(token, form);
      setForm(EMPTY);
      // Accounts live in the database; the old session is meaningless now.
      clear();
      nav("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
      setBusy(null);
    }
  }

  async function onReset() {
    setBusy("reset");
    setError(null);
    try {
      await api.adminDbReset(token);
      clear();
      nav("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setBusy(null);
    }
  }

  const c = status.current;
  const canSwitch = !!check?.ok && ack && busy === null;

  return (
    <section className="settings-section">
      <header>
        <h2>Server database</h2>
        <p className="settings-section-hint">
          Admin only. Point this Passman server at a different PostgreSQL
          database. It affects <strong>every user</strong>. The current database
          is left untouched — nothing is copied or deleted, so accounts and
          credentials stay in it, and the new database starts with whatever it
          already contains.
        </p>
      </header>

      <div className="settings-row">
        <span>
          <span className="settings-label">Currently connected</span>
          <span className="settings-status-meta">
            {c.username}@{c.host}:{c.port ?? "?"}/{c.database}
            {c.sslmode ? ` · ssl=${c.sslmode}` : ""}
          </span>
        </span>
        <span className="settings-count">
          {status.source === "saved" ? "saved in app" : ".env default"}
        </span>
      </div>

      <div className="db-form">
        <label>
          Host
          <input
            value={form.host}
            onChange={(e) => edit({ host: e.target.value.trim() })}
            placeholder="db.example.com"
            autoComplete="off"
          />
        </label>
        <label>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => edit({ port: Number(e.target.value) })}
          />
        </label>
        <label>
          Database
          <input
            value={form.database}
            onChange={(e) => edit({ database: e.target.value })}
            placeholder="passman"
            autoComplete="off"
          />
        </label>
        <label>
          Username
          <input
            value={form.username}
            onChange={(e) => edit({ username: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => edit({ password: e.target.value })}
            autoComplete="new-password"
          />
        </label>
        <label>
          SSL
          <select
            value={form.sslmode}
            onChange={(e) => edit({ sslmode: e.target.value as DbConnectionBody["sslmode"] })}
          >
            <option value="prefer">Prefer</option>
            <option value="require">Require</option>
            <option value="disable">Disable</option>
          </select>
        </label>
      </div>

      {check && (
        <p className={check.ok ? "db-result ok" : "db-result bad"} role="status">
          {check.ok
            ? `✓ Connected (PostgreSQL ${check.server_version}). ${SCHEMA_TEXT[check.schema_state]}`
            : `✗ ${check.error ?? SCHEMA_TEXT[check.schema_state]}`}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <label className="db-ack">
        <input
          type="checkbox"
          checked={ack}
          disabled={!check?.ok}
          onChange={(e) => setAck(e.target.checked)}
        />
        <span>
          I understand this switches the server for all users and signs everyone
          out. Existing data stays in the old database. The admin account will
          not exist in an empty database — I must register it again straight
          away (anyone could register that email first).
        </span>
      </label>

      <div className="settings-row">
        <button
          type="button"
          className="btn"
          disabled={!filled || busy !== null}
          onClick={onTest}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button type="button" disabled={!canSwitch} onClick={onSwitch}>
          {busy === "switch" ? "Switching…" : "Switch database"}
        </button>
      </div>

      {status.source === "saved" && (
        <div className="settings-row">
          <span className="settings-status-meta">
            Go back to the database from the server's .env file.
          </span>
          {confirmReset ? (
            <button type="button" disabled={busy !== null} onClick={onReset}>
              {busy === "reset" ? "Resetting…" : "Confirm reset & sign out"}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
              Reset to .env default
            </button>
          )}
        </div>
      )}
    </section>
  );
}
