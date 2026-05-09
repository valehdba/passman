import { useState } from "react";

import {
  effectiveProtocol,
  engineCode,
  protocolLabel,
} from "../../connect/index.js";
import { copyPlain, copySensitive } from "../../connect/clipboard.js";
import { formatRelative, getLastUsed } from "./lastUsed.js";
import { envClass, type DecryptedItem } from "./types.js";

interface Props {
  items: DecryptedItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onConnect: (item: DecryptedItem) => void;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
}

export function CredentialsGrid({
  items,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onConnect,
  onDelete,
  onToast,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="grid-panel">
        <div className="empty-state">
          <strong>No credentials match.</strong>
          <div>Adjust your search, group filter, or add a new credential.</div>
        </div>
      </div>
    );
  }

  const allSelected =
    items.length > 0 && items.every((it) => selectedIds.has(it.id));

  return (
    <div className="grid-panel">
      <div className="grid">
        <div className="head cell-check">
          <button
            type="button"
            className={`check ${allSelected ? "on" : ""}`}
            aria-label="Select all"
            onClick={onToggleSelectAll}
          />
        </div>
        <div className="head sortable sorted">
          Name <span className="arrow">↑</span>
        </div>
        <div className="head">Hostname</div>
        <div className="head">IP</div>
        <div className="head">User</div>
        <div className="head">Password</div>
        <div className="head">Port</div>
        <div className="head">Protocol</div>
        <div className="head">Env</div>
        <div className="head">Last used</div>
        <div className="head" />
        <div className="head" />

        {items.map((it) => (
          <Row
            key={it.id}
            item={it}
            selected={selectedIds.has(it.id)}
            onToggleSelect={onToggleSelect}
            onConnect={onConnect}
            onDelete={onDelete}
            onToast={onToast}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  item: DecryptedItem;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onConnect: (item: DecryptedItem) => void;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
}

function Row({
  item,
  selected,
  onToggleSelect,
  onConnect,
  onDelete,
  onToast,
}: RowProps) {
  const p = item.plaintext;
  const protocol = effectiveProtocol(p);
  const protoKey = protocol ?? "unknown";
  const proto = protocolLabel(protocol);
  const env = p.environment;
  const ec = envClass(env);
  const last = formatRelative(getLastUsed(item.id));

  const [revealed, setRevealed] = useState(false);

  async function copyPassword(e: React.MouseEvent) {
    e.stopPropagation();
    await copySensitive(p.password);
    onToast("Password copied · clears in 30 s");
  }

  async function copyHost(e: React.MouseEvent) {
    e.stopPropagation();
    const value = p.hostname || p.ip || "";
    if (!value) return;
    await copyPlain(value);
    onToast(p.hostname ? "Hostname copied" : "IP copied");
  }

  return (
    <div className={`row ${selected ? "selected" : ""}`}>
      <div className="cell-check" data-col="">
        <button
          type="button"
          className={`check ${selected ? "on" : ""}`}
          aria-label={selected ? "Deselect row" : "Select row"}
          onClick={() => onToggleSelect(item.id)}
        />
      </div>

      <div className="name-cell" data-col="Name">
        <span className={`engine-tile e-${protoKey}`}>
          {engineCode(protocol)}
        </span>
        <div className="name-block">
          <div className="name-row">
            <span className="name" title={p.name}>{p.name}</span>
            {item.location === "local" && (
              <span
                className="storage-badge"
                title="Stored on this device only — never sent to the server"
              >
                Device
              </span>
            )}
          </div>
          {p.url && (
            <span className="url" title={p.url}>
              {p.url}
            </span>
          )}
        </div>
      </div>

      <div className="mono" data-col="Hostname" onClick={copyHost} title="Click to copy">
        {p.hostname || "—"}
      </div>

      <div className="mono" data-col="IP">
        {p.ip || "—"}
      </div>

      <div className="mono" data-col="User">
        {p.username || "—"}
      </div>

      <div className="pw-cell" data-col="Password">
        <code className="pw">{revealed ? p.password : "••••••••••••"}</code>
        <span className="pw-actions">
          <button
            type="button"
            className={`icon-btn ${revealed ? "active" : ""}`}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button type="button" className="icon-btn" onClick={copyPassword}>
            Copy
          </button>
        </span>
      </div>

      <div className="mono" data-col="Port">
        {p.port !== undefined ? p.port : "—"}
      </div>

      <div data-col="Protocol">
        <span className={`proto proto-${protoKey}`}>{proto}</span>
      </div>

      <div data-col="Env">
        {env ? <span className={`tag tag-${ec}`}>{env}</span> : <span className="last-used">—</span>}
      </div>

      <div className="last-used" data-col="Last used">
        {last}
      </div>

      <div data-col="">
        <button
          type="button"
          className="connect-btn"
          onClick={() => onConnect(item)}
        >
          Connect <span className="arrow">→</span>
        </button>
      </div>

      <div data-col="">
        <button
          type="button"
          className="kebab"
          aria-label="Delete row"
          title="Delete"
          onClick={() => onDelete(item.id)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
