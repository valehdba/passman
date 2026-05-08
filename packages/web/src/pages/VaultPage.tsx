import { useEffect, useState } from "react";
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

export function VaultPage() {
  const nav = useNavigate();
  const { accessToken, refreshToken, vault, clear } = useSession();

  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-item form
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<VaultLoginPlaintext>({
    name: "",
    username: "",
    password: "",
    url: "",
  });

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
      const encoded = await encryptVaultLogin(draft, vault);
      await api.createItem(accessToken, {
        item_type: encoded.itemType,
        encrypted_data: encoded.encryptedData,
      });
      setDraft({ name: "", username: "", password: "", url: "" });
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

  return (
    <main className="vault-container">
      <header>
        <h1>Vault</h1>
        <button onClick={onLogout}>Lock & sign out</button>
      </header>
      {error && <p className="error">{error}</p>}
      {loading ? <p>Loading...</p> : (
        <ul className="vault-list">
          {items.map((it) => (
            <li key={it.id}>
              <strong>{it.plaintext.name}</strong>
              <span>{it.plaintext.username}</span>
              {it.plaintext.url && <span>{it.plaintext.url}</span>}
              <button onClick={() => navigator.clipboard.writeText(it.plaintext.password)}>
                Copy password
              </button>
              <button onClick={() => onDelete(it.id)}>Delete</button>
            </li>
          ))}
          {items.length === 0 && <li>No items yet.</li>}
        </ul>
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)}>+ Add login</button>
      ) : (
        <form onSubmit={onAdd}>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            Username
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
              value={draft.url ?? ""}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
          </label>
          <button type="submit">Save</button>
          <button type="button" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
    </main>
  );
}
