/**
 * Storage facade — fan-out over the server vault and the local IndexedDB
 * store. The rest of the app talks to this module instead of the API
 * client + local store directly, so individual call sites don't have to
 * branch on storage location.
 *
 * Items returned from `listAll` carry a `location` tag set by THIS layer
 * — that tag is metadata about *where the ciphertext came from*, NOT a
 * field inside the encrypted plaintext (so existing items don't need
 * migration).
 */

import { type VaultItem, api } from "../api/client.js";
import {
  createLocalItem,
  deleteLocalItem,
  listLocalItems,
  type LocalItemRecord,
} from "./local.js";

export type StorageLocation = "server" | "local";

/** A `VaultItem` plus the storage tag added by the facade. */
export interface LocatedItem extends VaultItem {
  location: StorageLocation;
}

/**
 * Fetch every item the user has access to, both from the server and the
 * local IndexedDB store, tagged with `location`. Local items keep the same
 * shape as server items — same id, same encrypted_data envelope — they
 * differ only in the tag.
 *
 * Errors from the server are surfaced; local-store failures fall back to
 * an empty list with a warning logged. Rationale: a corrupt local store
 * shouldn't block the user from seeing their server-stored credentials.
 */
export async function listAll(
  accessToken: string,
  vault: string,
): Promise<LocatedItem[]> {
  const [serverItems, localItems] = await Promise.all([
    api
      .listItems(accessToken)
      .then((r) =>
        r.items.map<LocatedItem>((it) => ({ ...it, location: "server" })),
      ),
    listLocalItems(vault)
      .then((rows) => rows.map<LocatedItem>(localToVaultItem))
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[passman] local store unreadable:", e);
        return [] as LocatedItem[];
      }),
  ]);
  return [...serverItems, ...localItems];
}

function localToVaultItem(row: LocalItemRecord): LocatedItem {
  return {
    id: row.id,
    item_type: row.item_type,
    encrypted_data: row.encrypted_data,
    created_at: row.created_at,
    updated_at: row.updated_at,
    location: "local",
  };
}

export interface CreateParams {
  accessToken: string;
  vault: string;
  item_type: string;
  encrypted_data: string;
  location: StorageLocation;
}

/** Create a new item in the chosen store. Returns the persisted record. */
export async function createItem(params: CreateParams): Promise<LocatedItem> {
  if (params.location === "local") {
    const row = await createLocalItem({
      vault: params.vault,
      item_type: params.item_type,
      encrypted_data: params.encrypted_data,
    });
    return localToVaultItem(row);
  }
  const created = await api.createItem(params.accessToken, {
    item_type: params.item_type,
    encrypted_data: params.encrypted_data,
  });
  return { ...created, location: "server" };
}

/**
 * Delete an item from the store it lives in. The caller is expected to
 * pass the location tag they got from `listAll` — we don't go fishing
 * across stores by id, since server and local id-spaces don't overlap.
 */
export async function deleteItem(
  accessToken: string,
  id: string,
  location: StorageLocation,
): Promise<void> {
  if (location === "local") {
    await deleteLocalItem(id);
    return;
  }
  await api.deleteItem(accessToken, id);
}
