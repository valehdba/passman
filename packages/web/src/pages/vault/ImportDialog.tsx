import { useEffect, useRef, useState } from "react";

import type { VaultLoginPlaintext } from "@passman/core";

import {
  parseBitwardenCsv,
  type ImportCandidate,
  type ImportResult,
} from "../../import/index.js";
import type { StorageLocation } from "../../storage/index.js";

interface Props {
  /** Called for each candidate as we save it; the parent decides where the
   *  ciphertext goes (server / local) and handles encryption. */
  onSaveOne: (item: VaultLoginPlaintext, location: StorageLocation) => Promise<void>;
  onClose: () => void;
}

/**
 * Three-step modal: pick a file, preview parsed candidates + skipped rows,
 * confirm import. The actual save loop happens in the parent so encryption
 * + storage routing live in one place.
 */
export function ImportDialog({ onSaveOne, onClose }: Props) {
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [storeLocally, setStoreLocally] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Esc closes (matching ConnectDialog's behaviour).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function onPickFile(file: File) {
    setErr(null);
    setFilename(file.name);
    if (file.size > 10 * 1024 * 1024) {
      setErr("File too large (max 10 MB)");
      return;
    }
    try {
      const text = await file.text();
      const result = parseBitwardenCsv(text);
      setParsed(result);
      if (result.candidates.length === 0 && result.skipped.length > 0) {
        setErr(
          result.skipped[0]!.reason.startsWith("Missing required")
            ? result.skipped[0]!.reason
            : "No importable rows found",
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to read file");
    }
  }

  async function runImport(candidates: ImportCandidate[]) {
    setRunning(true);
    setProgress(0);
    try {
      for (let i = 0; i < candidates.length; i++) {
        await onSaveOne(
          candidates[i]!.plaintext,
          storeLocally ? "local" : "server",
        );
        setProgress(i + 1);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed mid-batch");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="import-title">Import credentials</h2>
            <div className="target">From a Bitwarden CSV export</div>
          </div>
          <button
            className="x"
            onClick={() => !running && onClose()}
            aria-label="Close"
            disabled={running}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {!parsed && (
            <div className="import-step">
              <p className="import-hint">
                In Bitwarden: <strong>Tools → Export vault → File format CSV</strong>.
                The export contains plaintext passwords — keep the file on this device, import below, then delete it.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                }}
              />
              {err && <p className="error">{err}</p>}
            </div>
          )}

          {parsed && (
            <div className="import-step">
              <p className="import-summary">
                <strong>{filename}</strong> · {parsed.candidates.length} importable
                {parsed.skipped.length > 0 && (
                  <> · {parsed.skipped.length} skipped</>
                )}
              </p>
              {parsed.candidates.length > 0 && (
                <div className="import-list">
                  {parsed.candidates.slice(0, 50).map((c) => (
                    <div key={c.sourceRow} className="import-row">
                      <span className="import-row-name">{c.plaintext.name}</span>
                      {c.plaintext.username && (
                        <span className="import-row-meta">
                          {c.plaintext.username}
                        </span>
                      )}
                      {c.plaintext.url && (
                        <span className="import-row-meta">{c.plaintext.url}</span>
                      )}
                    </div>
                  ))}
                  {parsed.candidates.length > 50 && (
                    <div className="import-row import-row-more">
                      …and {parsed.candidates.length - 50} more
                    </div>
                  )}
                </div>
              )}

              {parsed.skipped.length > 0 && (
                <details className="import-skipped">
                  <summary>{parsed.skipped.length} skipped rows</summary>
                  <ul>
                    {parsed.skipped.slice(0, 50).map((s) => (
                      <li key={s.sourceRow}>
                        Row {s.sourceRow}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <label className={`storage-toggle ${storeLocally ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={storeLocally}
                  onChange={(e) => setStoreLocally(e.target.checked)}
                />
                <span className="storage-toggle-body">
                  <span className="storage-toggle-title">
                    Store all imported items on this device only
                  </span>
                  <span className="storage-toggle-hint">
                    Same trade-offs as the per-credential toggle: no sync,
                    cleared if you clear site data, no off-device backup.
                  </span>
                </span>
              </label>

              {running && (
                <div className="import-progress" role="status">
                  Importing {progress} / {parsed.candidates.length}…
                </div>
              )}
              {err && <p className="error">{err}</p>}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {parsed && parsed.candidates.length > 0 && !running && (
            <button
              className="btn btn-primary"
              onClick={() => void runImport(parsed.candidates)}
            >
              Import {parsed.candidates.length} credential
              {parsed.candidates.length === 1 ? "" : "s"}
            </button>
          )}
          <button onClick={onClose} disabled={running}>
            {running ? "Importing…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
