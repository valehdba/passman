import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  decryptVaultLogin,
  encryptVaultLogin,
  type VaultLoginPlaintext,
} from "@passman/core";

import { type VaultItem, api } from "../api/client.js";
import { useSession } from "../stores/session.js";

interface DecryptedItem extends VaultItem {
  plaintext: VaultLoginPlaintext;
}

type GroupKey = "none" | "hostname" | "ip" | "username" | "port";

const GROUP_OPTIONS: { value: GroupKey; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "hostname", label: "Hostname" },
  { value: "ip", label: "IP address" },
  { value: "username", label: "User" },
  { value: "port", label: "Port" },
];

interface DraftState {
  name: string;
  username: string;
  password: string;
  hostname: string;
  ip: string;
  port: string;
  url: string;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  username: "",
  password: "",
  hostname: "",
  ip: "",
  port: "",
  url: "",
};

function groupValue(item: DecryptedItem, key: GroupKey): string {
  if (key === "none") return "";
  const raw = item.plaintext[key];
  if (raw === undefined || raw === null || raw === "") return "(unspecified)";
  return String(raw);
}

function matchesQuery(item: DecryptedItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const p = item.plaintext;
  const haystack = [
    p.name,
    p.username,
    p.hostname,
    p.ip,
    p.url,
    p.notes,
    p.port !== undefined ? String(p.port) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function VaultPage() {
  const nav = useNavigate();
  const { accessToken, refreshToken, vault, clear } = useSession();

  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  useEffect(() => {
    if (!accessToken || !vault) {
      nav("/login");
      return;
    }
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadItems() {
    if (!accessToken || !vault) return;
    setLoading(true);
    setError(null);
    try {
      const { items: encrypted } = await api.listItems(accessToken);
      const decoded = await Promise.all(
        encrypted.map(async (it) => ({
          ...it,
          plaintext: await decryptVaultLogin(it.encrypted_data, vault),
        })),
      );
      setItems(decoded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !vault) return;
    try {
      // Only persist fields the user actually filled in.
      const portNum = draft.port === "" ? NaN : Number(draft.port);
      const cleaned: VaultLoginPlaintext = {
        name: draft.name,
        username: draft.username,
        password: draft.password,
        ...(draft.hostname ? { hostname: draft.hostname } : {}),
        ...(draft.ip ? { ip: draft.ip } : {}),
        ...(Number.isFinite(portNum) ? { port: portNum } : {}),
        ...(draft.url ? { url: draft.url } : {}),
      };
      const encoded = await encryptVaultLogin(cleaned, vault);
      await api.createItem(accessToken, {
        item_type: encoded.itemType,
        encrypted_data: encoded.encryptedData,
      });
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    }
  }

  async function onLogout() {
    if (accessToken && refreshToken) {
      try {
        await api.logout(accessToken, refreshToken);
      } catch {
        /* ignore — local clear is what matters */
      }
    }
    clear();
    nav("/login");
  }

  async function onDelete(id: string) {
    if (!accessToken) return;
    if (!confirm("Delete this item?")) return;
    try {
      await api.deleteItem(accessToken, id);
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const filtered = useMemo(
    () => items.filter((it) => matchesQuery(it, query)),
    [items, query],
  );

  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "", label: "", items: filtered }];
    }
    const map = new Map<string, DecryptedItem[]>();
    for (const it of filtered) {
      const k = groupValue(it, groupBy);
      const bucket = map.get(k);
      if (bucket) bucket.push(it);
      else map.set(k, [it]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, list]) => ({ key, label: key, items: list }));
  }, [filtered, groupBy]);

  function toggleReveal(id: string) {
    setRevealed((r) => ({ ...r, [id]: !r[id] }));
  }

  return (
    <main className="vault-container">
      <header>
        <h1>Vault</h1>
        <button onClick={onLogout}>Lock & sign out</button>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="vault-toolbar">
        <input
          type="search"
          className="vault-search"
          placeholder="Search hostname, IP, user, name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search credentials"
        />
        <label className="vault-group-label">
          Group by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupKey)}
          >
            {GROUP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {!adding && (
          <button onClick={() => setAdding(true)}>+ Add login</button>
        )}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="vault-empty">
          {items.length === 0 ? "No items yet." : "No matches for that search."}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key || "__all"} className="vault-group">
            {groupBy !== "none" && (
              <h2 className="vault-group-heading">
                {g.label} <span className="vault-group-count">({g.items.length})</span>
              </h2>
            )}
            <div className="vault-grid" role="table">
              <div className="vault-grid-row vault-grid-head" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Hostname</span>
                <span role="columnheader">IP address</span>
                <span role="columnheader">User</span>
                <span role="columnheader">Password</span>
                <span role="columnheader">Port</span>
                <span role="columnheader" aria-label="Actions" />
              </div>
              {g.items.map((it) => {
                const p = it.plaintext;
                const isRevealed = !!revealed[it.id];
                return (
                  <div key={it.id} className="vault-grid-row" role="row">
                    <span role="cell" data-col="Name">
                      <strong>{p.name}</strong>
                    </span>
                    <span role="cell" data-col="Hostname">{p.hostname ?? "—"}</span>
                    <span role="cell" data-col="IP">{p.ip ?? "—"}</span>
                    <span role="cell" data-col="User">{p.username || "—"}</span>
                    <span role="cell" data-col="Password" className="vault-pw-cell">
                      <code>{isRevealed ? p.password : "••••••••"}</code>
                      <button
                        type="button"
                        className="vault-icon-btn"
                        onClick={() => toggleReveal(it.id)}
                      >
                        {isRevealed ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        className="vault-icon-btn"
                        onClick={() => navigator.clipboard.writeText(p.password)}
                      >
                        Copy
                      </button>
                    </span>
                    <span role="cell" data-col="Port">
                      {p.port !== undefined ? p.port : "—"}
                    </span>
                    <span role="cell" className="vault-actions">
                      <button
                        type="button"
                        className="vault-icon-btn vault-danger"
                        onClick={() => onDelete(it.id)}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {adding && (
        <form onSubmit={onAdd} className="vault-add-form">
          <h2>New credential</h2>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <div className="vault-form-row">
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
          <label>
            User
            <input
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
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
          <label>
            URL
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
          </label>
          <div className="vault-form-actions">
            <button type="submit">Save</button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
