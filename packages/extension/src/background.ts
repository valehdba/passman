/**
 * Background service worker.
 *
 * Holds the unlocked vault session in MV3 worker memory. When the worker is
 * suspended (Chrome idles it after ~30s) the in-memory key is dropped — this
 * is good for security but means the user re-unlocks more often. Trade-off
 * is by design.
 *
 * Anti-phishing: matches use exact-origin equality (scheme + host + port),
 * never substring/host-suffix matching.
 */
import {
  decryptVaultLogin,
  deriveLoginAuthKey,
  unlock,
  type VaultLoginPlaintext,
  type VaultSession,
} from "@passman/core";

import type { Message, Response } from "./messages.js";

const API_BASE = "http://localhost:8000/api"; // configure for prod

interface DecryptedItem {
  id: string;
  itemType: string;
  plaintext: VaultLoginPlaintext;
}

let vault: VaultSession | null = null;
let accessToken: string | null = null;
let email: string | null = null;
let cachedItems: DecryptedItem[] = [];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`${r.status}: ${detail || r.statusText}`);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth + sync
// ---------------------------------------------------------------------------

export async function unlockVault(emailIn: string, password: string): Promise<void> {
  const kdf = await api<{
    kdf_salt: string;
    kdf_time_cost: number;
    kdf_memory_cost: number;
    kdf_parallelism: number;
  }>(`/accounts/kdf?email=${encodeURIComponent(emailIn)}`);

  const kdfParams = {
    salt: kdf.kdf_salt,
    timeCost: kdf.kdf_time_cost,
    memoryCost: kdf.kdf_memory_cost,
    parallelism: kdf.kdf_parallelism,
  };
  const authKey = await deriveLoginAuthKey(password, kdfParams);

  const tokens = await api<{
    access_token: string;
    refresh_token: string;
    encrypted_symmetric_key: string;
  }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ email: emailIn, auth_key: authKey }),
  });

  vault = await unlock(password, kdfParams, tokens.encrypted_symmetric_key);
  accessToken = tokens.access_token;
  email = emailIn;

  await refreshVaultCache();
}

export function lockVault(): void {
  vault?.lock();
  vault = null;
  accessToken = null;
  email = null;
  cachedItems = [];
}

async function refreshVaultCache(): Promise<void> {
  if (!vault || !accessToken) return;
  const { items } = await api<{
    items: Array<{ id: string; item_type: string; encrypted_data: string }>;
  }>("/vault/items", {}, accessToken);

  const decrypted: DecryptedItem[] = [];
  for (const it of items) {
    if (it.item_type !== "login") continue;
    try {
      const plain = await decryptVaultLogin(it.encrypted_data, vault);
      decrypted.push({ id: it.id, itemType: it.item_type, plaintext: plain });
    } catch {
      // Skip items we can't decrypt (corrupted / different schema version).
    }
  }
  cachedItems = decrypted;
}

// ---------------------------------------------------------------------------
// Origin matching — strict exact match against item URL's origin
// ---------------------------------------------------------------------------

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin; // scheme + host + port
  } catch {
    return null;
  }
}

function findMatches(pageOrigin: string): DecryptedItem[] {
  return cachedItems.filter((it) => {
    if (!it.plaintext.url) return false;
    const itemOrigin = originOf(it.plaintext.url);
    return itemOrigin !== null && itemOrigin === pageOrigin;
  });
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: Message, _sender, sendResponse: (r: Response) => void) => {
    void (async () => {
      try {
        if (msg.kind === "vault:status") {
          sendResponse({ kind: "status", locked: vault === null, email });
          return;
        }
        if (msg.kind === "vault:unlock") {
          await unlockVault(msg.email, msg.password);
          sendResponse({ kind: "ok", ok: true });
          return;
        }
        if (msg.kind === "vault:lock") {
          lockVault();
          sendResponse({ kind: "ok", ok: true });
          return;
        }
        if (vault === null) {
          sendResponse({ kind: "error", message: "Vault is locked", error: "locked" });
          return;
        }
        if (msg.kind === "vault:matches") {
          const matches = findMatches(msg.origin).map((it) => ({
            id: it.id,
            name: it.plaintext.name,
            username: it.plaintext.username,
          }));
          sendResponse({ kind: "matches", items: matches });
          return;
        }
        if (msg.kind === "vault:reveal") {
          const item = cachedItems.find((it) => it.id === msg.itemId);
          if (!item) {
            sendResponse({ kind: "error", message: "Item not found" });
            return;
          }
          sendResponse({
            kind: "credentials",
            username: item.plaintext.username,
            password: item.plaintext.password,
          });
          return;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ kind: "error", message, error: message });
      }
    })();
    return true; // keep the channel open for the async response
  },
);

// Exposed for popup to call directly via chrome.runtime
declare global {
  interface ServiceWorkerGlobalScope {
    passmanUnlock: typeof unlockVault;
    passmanLock: typeof lockVault;
  }
}
(self as unknown as ServiceWorkerGlobalScope).passmanUnlock = unlockVault;
(self as unknown as ServiceWorkerGlobalScope).passmanLock = lockVault;
