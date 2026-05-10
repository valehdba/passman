import { useEffect, useState } from "react";

import { ApiError, api, type TotpSetup } from "../../api/client.js";
import { copyPlain } from "../../connect/clipboard.js";
import { formatSecretForDisplay, renderOtpauthQr } from "../../twofactor/index.js";

interface Props {
  accessToken: string;
  onClose: () => void;
  onDone: () => void;
}

type Step = "loading" | "scan" | "confirm" | "recovery";

/**
 * Three-step modal:
 *   1. POST /account/totp/setup → render the QR + base32 fallback
 *   2. User scans, types the first code → POST /confirm
 *   3. Show recovery codes, prompt user to write them down, then close
 *
 * The user can't navigate back from step 3 — once we've shown the codes
 * they're not recoverable from the server (only Argon2id hashes survive).
 */
export function TotpSetupFlow({ accessToken, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qrSvg, setQrSvg] = useState<string>("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fire the setup call once on mount.
  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const s = await api.totpSetup(accessToken);
        if (cancelled) return;
        setSetup(s);
        setQrSvg(await renderOtpauthQr(s.provisioning_uri));
        setStep("scan");
      } catch (e) {
        if (cancelled) return;
        setErr(
          e instanceof ApiError && e.status === 401
            ? "Your session expired. Please log in again."
            : e instanceof Error
              ? e.message
              : "Failed to start 2FA setup",
        );
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Esc closes during the early steps; once codes are shown we force a
  // deliberate "I've saved them" click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "recovery" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step, busy]);

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.totpConfirm(accessToken, code.trim());
      setRecoveryCodes(r.recovery_codes);
      setStep("recovery");
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 401
          ? "That code didn't match — make sure your phone's clock is on time and try the next one."
          : e instanceof Error
            ? e.message
            : "Failed to confirm code",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyAllCodes() {
    await copyPlain(recoveryCodes.join("\n"));
  }

  function downloadCodes() {
    const blob = new Blob([recoveryCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "passman-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "recovery" && !busy) onClose();
      }}
    >
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              {step === "recovery"
                ? "Save your recovery codes"
                : "Set up two-factor authentication"}
            </h2>
            <div className="target">
              {step === "scan" && "Step 1 of 2 · Scan the QR with your authenticator"}
              {step === "confirm" && "Step 2 of 2 · Enter a code to confirm"}
              {step === "recovery" && "One-time only — store these somewhere safe"}
            </div>
          </div>
          {step !== "recovery" && (
            <button className="x" onClick={onClose} disabled={busy} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div className="modal-body">
          {step === "loading" && <p className="settings-loading">Generating secret…</p>}

          {step === "scan" && setup && (
            <div className="totp-scan">
              <div
                className="totp-qr"
                aria-label="QR code for your authenticator app"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="totp-scan-info">
                <p className="settings-section-hint">
                  Open Google Authenticator / 1Password / Authy / etc. and scan
                  this code. Then click <strong>Next</strong>.
                </p>
                <details className="totp-manual">
                  <summary>Can't scan? Type this manually</summary>
                  <code className="totp-secret-display">
                    {formatSecretForDisplay(setup.secret_base32)}
                  </code>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void copyPlain(setup.secret_base32)}
                  >
                    Copy
                  </button>
                </details>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <form className="totp-confirm" onSubmit={onConfirm}>
              <label>
                6-digit code from your authenticator
                <input
                  autoFocus
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              {err && <p className="error">{err}</p>}
            </form>
          )}

          {step === "recovery" && (
            <div className="totp-recovery">
              <p className="warning">
                ⚠️ <strong>Save these codes now.</strong> Each one logs you in
                once if you lose access to your authenticator app. They are
                shown <strong>only this time</strong> — Passman keeps only a
                hash on the server, so this list cannot be recovered later.
              </p>
              <div className="totp-recovery-grid">
                {recoveryCodes.map((c, i) => (
                  <code key={i} className="totp-recovery-code">
                    {c}
                  </code>
                ))}
              </div>
              <div className="totp-recovery-actions">
                <button type="button" className="btn" onClick={() => void copyAllCodes()}>
                  Copy all
                </button>
                <button type="button" className="btn" onClick={downloadCodes}>
                  Download as .txt
                </button>
              </div>
            </div>
          )}

          {err && step !== "confirm" && <p className="error">{err}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {step === "scan" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep("confirm")}
            >
              Next →
            </button>
          )}
          {step === "confirm" && (
            <>
              <button type="button" onClick={() => setStep("scan")} disabled={busy}>
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || code.trim().length < 6}
                onClick={(e) => void onConfirm(e as unknown as React.FormEvent)}
              >
                {busy ? "Confirming…" : "Confirm & enable 2FA"}
              </button>
            </>
          )}
          {step === "recovery" && (
            <button type="button" className="btn btn-primary" onClick={onDone}>
              I've saved them — finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
