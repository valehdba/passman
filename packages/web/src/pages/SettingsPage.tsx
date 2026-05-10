import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, type TotpStatus } from "../api/client.js";
import { useBranding } from "../branding/index.js";
import { useSession } from "../stores/session.js";
import { TotpSetupFlow } from "./settings/TotpSetupFlow.js";
import { BrandHeader } from "./vault/BrandHeader.js";

/**
 * Settings page — v1 hosts only the 2FA management flow. The page is
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

      <p className="settings-back">
        <a href="/vault">← Back to vault</a>
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
