import { useEffect, useState } from "react";

import type { Protocol, VaultLoginPlaintext } from "@passman/core";

import { defaultPort, inferProtocolFromPort } from "../../connect/index.js";
import type { StorageLocation } from "../../storage/index.js";

interface DraftState {
  name: string;
  username: string;
  password: string;
  hostname: string;
  ip: string;
  port: string;
  protocol: Protocol | "";
  database: string;
  serviceName: string;
  domain: string;
  environment: string;
  url: string;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  username: "",
  password: "",
  hostname: "",
  ip: "",
  port: "",
  protocol: "",
  database: "",
  serviceName: "",
  domain: "",
  environment: "",
  url: "",
};

const PROTOCOL_OPTIONS: { value: Protocol | ""; label: string }[] = [
  { value: "", label: "— auto-detect from port —" },
  { value: "psql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "oracle", label: "Oracle" },
  { value: "mssql", label: "SQL Server" },
  { value: "redis", label: "Redis" },
  { value: "mongo", label: "MongoDB" },
  { value: "ssh", label: "SSH" },
  { value: "rdp", label: "RDP (Windows Remote Desktop)" },
  { value: "https", label: "HTTPS / web" },
  { value: "other", label: "Other" },
];

interface Props {
  onSubmit: (item: VaultLoginPlaintext, location: StorageLocation) => Promise<void>;
  onCancel: () => void;
}

export function AddCredentialForm({ onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [storeLocally, setStoreLocally] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-fill the port when the user picks a protocol but hasn't set one.
  useEffect(() => {
    if (!draft.protocol || draft.port) return;
    const dp = defaultPort(draft.protocol);
    if (dp !== undefined) {
      setDraft((d) => ({ ...d, port: String(dp) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.protocol]);

  const isDb = ["psql", "mysql", "mariadb", "oracle", "mssql", "mongo"].includes(
    draft.protocol || (inferProtocolFromPort(numOrUndef(draft.port)) ?? ""),
  );
  const isOracle = draft.protocol === "oracle";
  const isRdp =
    draft.protocol === "rdp" || numOrUndef(draft.port) === 3389;

  async function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const portNum = numOrUndef(draft.port);
      const cleaned: VaultLoginPlaintext = {
        name: draft.name,
        username: draft.username,
        password: draft.password,
        ...(draft.hostname ? { hostname: draft.hostname } : {}),
        ...(draft.ip ? { ip: draft.ip } : {}),
        ...(portNum !== undefined ? { port: portNum } : {}),
        ...(draft.protocol ? { protocol: draft.protocol } : {}),
        ...(draft.database ? { database: draft.database } : {}),
        ...(draft.serviceName ? { serviceName: draft.serviceName } : {}),
        ...(draft.domain ? { domain: draft.domain } : {}),
        ...(draft.environment ? { environment: draft.environment } : {}),
        ...(draft.url ? { url: draft.url } : {}),
      };
      await onSubmit(cleaned, storeLocally ? "local" : "server");
      setDraft(EMPTY_DRAFT);
      setStoreLocally(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add credential");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={onFormSubmit}>
      <h2>New credential</h2>

      <div className="add-form-grid">
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            placeholder="prod-pg-primary"
          />
        </label>
        <label>
          Protocol
          <select
            value={draft.protocol}
            onChange={(e) =>
              setDraft({ ...draft, protocol: e.target.value as Protocol | "" })
            }
          >
            {PROTOCOL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          Environment
          <input
            value={draft.environment}
            onChange={(e) => setDraft({ ...draft, environment: e.target.value })}
            placeholder="prod / staging / dev"
          />
        </label>
      </div>

      <div className="add-form-grid">
        <label>
          Hostname
          <input
            value={draft.hostname}
            onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
            placeholder="db-prod-01"
          />
        </label>
        <label>
          IP address
          <input
            value={draft.ip}
            onChange={(e) => setDraft({ ...draft, ip: e.target.value })}
            placeholder="10.0.0.42"
          />
        </label>
        <label>
          Port
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={65535}
            value={draft.port}
            onChange={(e) => setDraft({ ...draft, port: e.target.value })}
            placeholder="5432"
          />
        </label>
      </div>

      <div className="add-form-grid">
        <label>
          User
          <input
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            placeholder="postgres"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            required
          />
        </label>
        {isRdp && (
          <label>
            Windows AD domain
            <input
              value={draft.domain}
              onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
              placeholder="EXAMPLE"
            />
          </label>
        )}
      </div>

      {(isDb || isOracle) && (
        <div className="add-form-grid">
          <label>
            Database
            <input
              value={draft.database}
              onChange={(e) => setDraft({ ...draft, database: e.target.value })}
              placeholder={isOracle ? "SID (legacy)" : "app"}
            />
          </label>
          {isOracle && (
            <label>
              Service name (preferred)
              <input
                value={draft.serviceName}
                onChange={(e) =>
                  setDraft({ ...draft, serviceName: e.target.value })
                }
                placeholder="ERPSVC"
              />
            </label>
          )}
        </div>
      )}

      <div className="add-form-grid full-row">
        <label>
          URL
          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://… or postgres://…"
          />
        </label>
      </div>

      <label className={`storage-toggle ${storeLocally ? "on" : ""}`}>
        <input
          type="checkbox"
          checked={storeLocally}
          onChange={(e) => setStoreLocally(e.target.checked)}
        />
        <span className="storage-toggle-body">
          <span className="storage-toggle-title">
            Store on this device only
          </span>
          <span className="storage-toggle-hint">
            Encrypted ciphertext stays in this browser's IndexedDB · never sent to the server.
            <br />
            <strong>No cross-device sync</strong> · cleared if you clear site data ·
            single point of failure if this disk dies. Use for credentials you never
            want stored remotely, even encrypted.
          </span>
        </span>
      </label>

      {err && <p className="error">{err}</p>}

      <div className="add-form-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function numOrUndef(s: string): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
