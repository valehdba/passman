/**
 * IndexedDB-backed store for credentials the user opted to keep on-device.
 *
 * Important properties:
 * - The blob persisted here is the SAME ciphertext shape that the server
 *   would store — we encrypt with the same vault key. Locking the vault
 *   makes both server-fetched and local-only items unreadable.
 * - Records are addressable by a UUIDv4 generated client-side (so callers
 *   don't need a round-trip to mint an id).
 * - The store is keyed per vault by `email` (lowercased). Two accounts
 *   sharing a browser see disjoint local items.
 * - Failures are returned as rejected promises with descriptive errors —
 *   callers never silently lose a write.
 *
 * Persistence caveat the UI must surface to users:
 *   IndexedDB is wiped if the user clears site data, "Reset to defaults",
 *   or the OS user profile is deleted. There is no off-device backup.
 */

const DB_NAME = "passman-local-vault";
const DB_VERSION = 1;
const STORE = "items";

/** A row as persisted in IndexedDB. */
export interface LocalItemRecord {
  id: string;
  /** Lowercased email of the vault owner — segregates rows per account. */
  vault: string;
  /** Item type, currently always "login" for parity with the server schema. */
  item_type: string;
  /** Same ciphertext envelope the server would store. */
  encrypted_data: string;
  /** ISO-8601 timestamp set on creation. */
  created_at: string;
  /** ISO-8601 timestamp updated on each write. */
  updated_at: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // Index on `vault` so we can list per-account in O(matching rows).
        store.createIndex("by_vault", "vault", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () =>
      reject(new Error("IndexedDB open blocked — close other Passman tabs"));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let result: T | undefined;
        Promise.resolve(fn(store))
          .then((v) => {
            result = v;
          })
          .catch((e) => reject(e));
        transaction.oncomplete = () => {
          db.close();
          resolve(result as T);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error("Local store transaction aborted"));
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Local store transaction errored"));
        };
      }),
  );
}

/** Generate a UUIDv4. Uses crypto.randomUUID where available. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old contexts — RFC 4122 §4.4 random UUIDv4.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface CreateLocalParams {
  vault: string;
  item_type: string;
  encrypted_data: string;
}

/** Persist a new ciphertext blob; returns the full record including id + timestamps. */
export async function createLocalItem(
  params: CreateLocalParams,
): Promise<LocalItemRecord> {
  const now = new Date().toISOString();
  const record: LocalItemRecord = {
    id: newId(),
    vault: params.vault.toLowerCase(),
    item_type: params.item_type,
    encrypted_data: params.encrypted_data,
    created_at: now,
    updated_at: now,
  };
  await tx("readwrite", (store) => reqAsPromise(store.add(record)));
  return record;
}

/** Return every record for the given vault email, oldest first. */
export async function listLocalItems(vault: string): Promise<LocalItemRecord[]> {
  return tx("readonly", (store) => {
    const idx = store.index("by_vault");
    return reqAsPromise(idx.getAll(vault.toLowerCase()));
  }).then((rows) =>
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
}

/** Delete by id. Returns true if a record was removed, false if it didn't exist. */
export async function deleteLocalItem(id: string): Promise<boolean> {
  return tx("readwrite", async (store) => {
    const existing = await reqAsPromise(store.get(id));
    if (!existing) return false;
    await reqAsPromise(store.delete(id));
    return true;
  });
}

/** Wipe every record in every vault — used by tests and "Forget all local data" flows. */
export async function clearLocalStore(): Promise<void> {
  await tx("readwrite", (store) => reqAsPromise(store.clear()));
}

/** Count records belonging to a vault — cheap, used to gate UI hints. */
export async function countLocalItems(vault: string): Promise<number> {
  return tx("readonly", (store) => {
    const idx = store.index("by_vault");
    return reqAsPromise(idx.count(vault.toLowerCase()));
  });
}
