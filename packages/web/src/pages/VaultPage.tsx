import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  decryptVaultLogin,
  encryptVaultLogin,
  type VaultLoginPlaintext,
} from "@passman/core";

import { api } from "../api/client.js";
import {
  effectiveProtocol,
  protocolLabel,
} from "../connect/index.js";
import { useSession } from "../stores/session.js";
import { AddCredentialForm } from "./vault/AddCredentialForm.js";
import { ConnectDialog } from "./vault/ConnectDialog.js";
import { CredentialsGrid } from "./vault/CredentialsGrid.js";
import { IconLock, IconSearch } from "./vault/icons.js";
import { markUsed } from "./vault/lastUsed.js";
import { Sidebar, type SidebarScope } from "./vault/Sidebar.js";
import type { DecryptedItem } from "./vault/types.js";

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
    p.database,
    p.serviceName,
    p.domain,
    p.environment,
    p.port !== undefined ? String(p.port) : "",
    protocolLabel(effectiveProtocol(p)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matchesScope(item: DecryptedItem, scope: SidebarScope | null): boolean {
  if (!scope) return true;
  const p = item.plaintext;
  switch (scope.groupKey) {
    case "ip": return p.ip === scope.value;
    case "port": return p.port !== undefined && String(p.port) === scope.value;
    case "username": return p.username === scope.value;
    case "hostname": return p.hostname === scope.value;
    case "protocol": return protocolLabel(effectiveProtocol(p)) === scope.value;
    case "none": return true;
  }
}

export function VaultPage() {
  const nav = useNavigate();
  const { email, accessToken, refreshToken, vault, clear } = useSession();

  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SidebarScope | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connectingItem, setConnectingItem] = useState<DecryptedItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Trigger initial decrypt-and-load.
  useEffect(() => {
    if (!accessToken || !vault) {
      nav("/login");
      return;
    }
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K / Ctrl+K to focus the search box.
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

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

  async function onAdd(plaintext: VaultLoginPlaintext) {
    if (!accessToken || !vault) return;
    const encoded = await encryptVaultLogin(plaintext, vault);
    await api.createItem(accessToken, {
      item_type: encoded.itemType,
      encrypted_data: encoded.encryptedData,
    });
    setAdding(false);
    await loadItems();
    showToast("Credential added");
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
    if (!confirm("Delete this credential?")) return;
    try {
      await api.deleteItem(accessToken, id);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      await loadItems();
      showToast("Credential deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function onDeleteSelected() {
    if (!accessToken) return;
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} credential(s)?`)) return;
    try {
      await Promise.all(
        [...selected].map((id) => api.deleteItem(accessToken, id)),
      );
      setSelected(new Set());
      await loadItems();
      showToast(`${selected.size} credential(s) deleted`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) => {
      // "Are all *visible* rows currently selected?" — not just a size match.
      // A size match can be coincidental (e.g. you selected items in another
      // scope, then narrowed the view). The CredentialsGrid component's
      // header-checkbox visual uses the same `every`-based check, so the
      // toggle and the indicator stay in sync.
      const allVisibleSelected =
        filtered.length > 0 && filtered.every((it) => s.has(it.id));
      if (allVisibleSelected) {
        const next = new Set(s);
        for (const it of filtered) next.delete(it.id);
        return next;
      }
      const next = new Set(s);
      for (const it of filtered) next.add(it.id);
      return next;
    });
  }

  const filtered = useMemo(
    () => items.filter((it) => matchesScope(it, scope) && matchesQuery(it, query)),
    [items, scope, query],
  );

  const hostnameCount = useMemo(
    () => new Set(items.map((it) => it.plaintext.hostname).filter(Boolean)).size,
    [items],
  );
  const protocolCount = useMemo(
    () =>
      new Set(
        items.map((it) => protocolLabel(effectiveProtocol(it.plaintext))).filter((p) => p !== "—"),
      ).size,
    [items],
  );

  const scopeLabel = scope
    ? `${scope.groupKey === "username" ? "user" : scope.groupKey} : ${scope.value}`
    : "All credentials";

  return (
    <div className="vault-app">
      <Sidebar
        email={email}
        items={items}
        scope={scope}
        onScopeChange={setScope}
      />

      <main className="vault-main">
        <div className="vault-topbar">
          <div className="crumbs">
            <strong>Vault</strong>
            <span className="sep">/</span>
            {scopeLabel}
          </div>
          <div className="top-spacer" />
          <span className="pill">Zero-knowledge</span>
          <button className="btn" onClick={onLogout}>
            <IconLock /> Lock
          </button>
        </div>

        <div className="vault-headrow">
          <div>
            <h1>{scopeLabel}</h1>
            <p className="sub">
              <span>
                {filtered.length}
                {filtered.length !== items.length ? ` / ${items.length}` : ""} entries
              </span>
              {hostnameCount > 0 && (
                <>
                  <span className="dot" /> <span>{hostnameCount} hostnames</span>
                </>
              )}
              {protocolCount > 0 && (
                <>
                  <span className="dot" /> <span>{protocolCount} protocols</span>
                </>
              )}
              <span className="dot" /> <span>Decrypted in your browser</span>
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + New credential
          </button>
        </div>

        <div className="vault-toolbar">
          <div className="vault-search">
            <IconSearch />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search hostname, IP, user, name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search credentials"
            />
            <span className="kbd-hint">⌘K</span>
          </div>
          {scope && (
            <button className="btn btn-ghost" onClick={() => setScope(null)}>
              Clear group
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {selected.size > 0 && (
          <div className="sel-toolbar">
            <span className="count">{selected.size} selected</span>
            <button
              type="button"
              className="danger"
              onClick={onDeleteSelected}
            >
              Delete
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="clear"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid-panel">
            <div className="empty-state">Loading…</div>
          </div>
        ) : (
          <CredentialsGrid
            items={filtered}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onConnect={(it) => {
              markUsed(it.id);
              setConnectingItem(it);
            }}
            onDelete={onDelete}
            onToast={showToast}
          />
        )}

        {adding && (
          <AddCredentialForm
            onSubmit={onAdd}
            onCancel={() => setAdding(false)}
          />
        )}
      </main>

      <ConnectDialog
        item={connectingItem}
        onClose={() => setConnectingItem(null)}
        onUsed={(id) => markUsed(id)}
        onToast={showToast}
      />

      {toast && (
        <div className="toast" role="status">
          <span className="lock-ico"><IconLock /></span>
          {toast}
        </div>
      )}
    </div>
  );
}
