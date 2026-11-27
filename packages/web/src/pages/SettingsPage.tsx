import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError, api, type TotpStatus, type TrustedDevice } from "../api/client.js";
import { useBranding } from "../branding/index.js";
import { PROTOCOL_VALUES, usePreferences } from "../stores/preferences.js";
import { useSession } from "../stores/session.js";
import { clearAllTrustTokens } from "../stores/trustedDevice.js";
import { TotpSetupFlow } from "./settings/TotpSetupFlow.js";
import { BrandHeader } from "./vault/BrandHeader.js";

/**
 * Settings page — hosts 2FA management and local preferences. The page is
 * intentionally simple: a single Security section with status + actions.
 * As more settings land they slot in as additional sections.
 */
export function SettingsPage() {
  const nav = useNavigate();
  const branding = useBranding();
  const { accessToken } = useSession();

  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      nav("/login");
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!accessToken) return;
    try {
      const s = await api.totpStatus(accessToken);
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load 2FA status");
    }
  }

  return (
    <main className="auth-container settings-container">
      <BrandHeader />
      <h1>Settings</h1>
      {branding.tagline && <p className="auth-tagline">{branding.tagline}</p>}

      {error && <p className="error">{error}</p>}

      <section className="settings-section">
        <header>
          <h2>Two-factor authentication</h2>
          <p className="settings-section-hint">
            Adds a 6-digit code from your authenticator app (Google Authenticator,
            1Password, Authy, …) to login. <strong>Note:</strong> enabling 2FA
            stores the OTP secret server-side. Vault contents stay encrypted
            with your master key — the server still can't read them.
          </p>
        </header>

        {status === null ? (
          <p className="settings-loading">Loading…</p>
        ) : status.enabled ? (
          <TotpEnabledPanel
            status={status}
            onDisable={() => setDisableOpen(true)}
          />
        ) : (
          <TotpDisabledPanel onSetup={() => setSetupOpen(true)} />
        )}
      </section>

      {status?.enabled && <TrustedDevicesSection />}

      <PreferencesSection />

      <p className="settings-back">
        <Link to="/vault">← Back to vault</Link>
      </p>

      {setupOpen && accessToken && (
        <TotpSetupFlow
          accessToken={accessToken}
          onClose={() => setSetupOpen(false)}
          onDone={async () => {
            setSetupOpen(false);
            await refresh();
          }}
        />
      )}

      {disableOpen && accessToken && (
        <DisableTotpDialog
          accessToken={accessToken}
          onClose={() => setDisableOpen(false)}
          onDone={async () => {
            setDisableOpen(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function TotpDisabledPanel({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-status">
          <span className="status-dot status-dot-off" /> Not enabled
        </div>
      </div>
      <button type="button" className="btn btn-primary" onClick={onSetup}>
        Set up 2FA
      </button>
    </div>
  );
}

function TotpEnabledPanel({
  status,
  onDisable,
}: {
  status: TotpStatus;
  onDisable: () => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-status">
          <span className="status-dot status-dot-on" /> Enabled
        </div>
        <div className="settings-status-meta">
          {status.recovery_codes_remaining} recovery code
          {status.recovery_codes_remaining === 1 ? "" : "s"} remaining
        </div>
      </div>
      <button type="button" className="btn" onClick={onDisable}>
        Disable 2FA
      </button>
    </div>
  );
}

function DisableTotpDialog({
  accessToken,
  onClose,
  onDone,
}: {
  accessToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.totpDisable(accessToken, code.trim());
      onDone();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 401
          ? "That code didn't match. Try again or use a recovery code."
          : "Failed to disable 2FA",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Disable 2FA</h2>
            <div className="target">
              Confirm with a code from your authenticator app, or a recovery code.
            </div>
          </div>
          <button className="x" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          <label>
            6-digit code or recovery code
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456 or xxxx-xxxx"
              autoComplete="one-time-code"
              required
            />
          </label>
          {err && <p className="error">{err}</p>}
        </form>
        <div className="modal-foot">
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || code.trim().length < 4}
            onClick={(e) => void onSubmit(e as unknown as React.FormEvent)}
          >
            {busy ? "Disabling…" : "Disable 2FA"}
          </button>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

const CLIPBOARD_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 10, label: "10 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
];

/** Options list that always contains the current value (e.g. one set by an older build). */
function withCurrent(
  options: { value: number; label: string }[],
  current: number,
  unit: string,
) {
  return options.some((o) => o.value === current)
    ? options
    : [...options, { value: current, label: `${current} ${unit}` }].sort(
        (a, b) => a.value - b.value,
      );
}

function PreferencesSection() {
  const { autoLockMinutes, clipboardClearSeconds, defaultProtocol, update, reset } =
    usePreferences();

  return (
    <section className="settings-section">
      <header>
        <h2>Preferences</h2>
        <p className="settings-section-hint">
          Saved in this browser only — they are never sent to the server and do
          not follow you to another device. Changes apply immediately.
        </p>
      </header>

      <label className="settings-row">
        <span>
          <span className="settings-label">Auto-lock after inactivity</span>
          <span className="settings-status-meta">
            Locks the vault and returns to login when idle.
          </span>
        </span>
        <select
          value={autoLockMinutes}
          onChange={(e) => update({ autoLockMinutes: Number(e.target.value) })}
        >
          {withCurrent(AUTO_LOCK_OPTIONS, autoLockMinutes, "min").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span>
          <span className="settings-label">Clear copied passwords</span>
          <span className="settings-status-meta">
            How long a copied password stays on the clipboard.
          </span>
        </span>
        <select
          value={clipboardClearSeconds}
          onChange={(e) => update({ clipboardClearSeconds: Number(e.target.value) })}
        >
          {withCurrent(CLIPBOARD_OPTIONS, clipboardClearSeconds, "s").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span>
          <span className="settings-label">Default protocol</span>
          <span className="settings-status-meta">
            Pre-selected when adding a new credential.
          </span>
        </span>
        <select
          value={defaultProtocol}
          onChange={(e) =>
            update({ defaultProtocol: e.target.value as (typeof PROTOCOL_VALUES)[number] | "" })
          }
        >
          <option value="">None</option>
          {PROTOCOL_VALUES.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-row">
        <span />
        <button type="button" className="btn" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

/** "Chrome on macOS" from a raw User-Agent; falls back to the raw string. */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return browser && os ? `${browser} on ${os}` : (browser ?? os ?? ua.slice(0, 60));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function TrustedDevicesSection() {
  const accessToken = useSession((s) => s.accessToken);
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    try {
      setDevices(await api.listTrustedDevices(accessToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trusted devices");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function revoke(id: string) {
    if (!accessToken) return;
    setError(null);
    try {
      await api.revokeTrustedDevice(accessToken, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  async function revokeAll() {
    if (!accessToken) return;
    setError(null);
    try {
      await api.revokeAllTrustedDevices(accessToken);
      clearAllTrustTokens();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  return (
    <section className="settings-section">
      <header>
        <h2>Trusted devices</h2>
        <p className="settings-section-hint">
          Browsers where you chose "Trust this device" at login skip the
          authenticator code until the date shown. Your master password is
          still required. Revoke any you don't recognise or no longer use.
          Turning 2FA off removes them all.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      {devices === null ? (
        <p className="settings-loading">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="settings-loading">No trusted devices.</p>
      ) : (
        <>
          <ul className="trusted-list">
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <span className="trusted-ua">{describeAgent(d.user_agent)}</span>
                  <span className="settings-status-meta" style={{ display: "block" }}>
                    Trusted {fmtDate(d.created_at)}
                    {d.last_used_at ? ` · last used ${fmtDate(d.last_used_at)}` : ""} ·
                    expires {fmtDate(d.expires_at)}
                  </span>
                </span>
                <button type="button" className="btn" onClick={() => void revoke(d.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
          <div className="settings-row">
            <span />
            <button type="button" className="btn" onClick={() => void revokeAll()}>
              Revoke all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
