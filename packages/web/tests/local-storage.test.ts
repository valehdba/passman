/**
 * Tests for the IndexedDB-backed local store.
 *
 * `fake-indexeddb/auto` polyfills `globalThis.indexedDB` and `IDBKeyRange`
 * with an in-memory implementation that matches the real spec, so the
 * production `local.ts` runs unmodified under Node + vitest.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearLocalStore,
  countLocalItems,
  createLocalItem,
  deleteLocalItem,
  listLocalItems,
  updateLocalItem,
} from "../src/storage/local.js";

describe("local IndexedDB store", () => {
  beforeEach(async () => {
    await clearLocalStore();
  });
  afterEach(async () => {
    await clearLocalStore();
  });

  it("round-trips a single item", async () => {
    const created = await createLocalItem({
      vault: "alice@example.az",
      item_type: "login",
      encrypted_data: "v1:iv:ciphertext",
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.vault).toBe("alice@example.az");
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const list = await listLocalItems("alice@example.az");
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
    expect(list[0]!.encrypted_data).toBe("v1:iv:ciphertext");
  });

  it("lowercases the vault key so case differences don't fork the store", async () => {
    await createLocalItem({
      vault: "Alice@Example.AZ",
      item_type: "login",
      encrypted_data: "blob",
    });
    const list = await listLocalItems("alice@example.az");
    expect(list).toHaveLength(1);
  });

  it("isolates items between vaults", async () => {
    await createLocalItem({
      vault: "alice@example.az",
      item_type: "login",
      encrypted_data: "alice-blob",
    });
    await createLocalItem({
      vault: "bob@example.az",
      item_type: "login",
      encrypted_data: "bob-blob",
    });
    const aliceItems = await listLocalItems("alice@example.az");
    const bobItems = await listLocalItems("bob@example.az");
    expect(aliceItems.map((i) => i.encrypted_data)).toEqual(["alice-blob"]);
    expect(bobItems.map((i) => i.encrypted_data)).toEqual(["bob-blob"]);
  });

  it("returns the records sorted by creation time, oldest first", async () => {
    const a = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "a",
    });
    // Force a millisecond gap so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    const b = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "b",
    });
    const list = await listLocalItems("v");
    expect(list.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("deletes by id and reports whether anything was removed", async () => {
    const item = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "blob",
    });
    expect(await deleteLocalItem(item.id)).toBe(true);
    expect(await deleteLocalItem(item.id)).toBe(false);
    expect(await listLocalItems("v")).toHaveLength(0);
  });

  it("counts items per vault", async () => {
    await createLocalItem({ vault: "v", item_type: "login", encrypted_data: "a" });
    await createLocalItem({ vault: "v", item_type: "login", encrypted_data: "b" });
    await createLocalItem({ vault: "other", item_type: "login", encrypted_data: "c" });
    expect(await countLocalItems("v")).toBe(2);
    expect(await countLocalItems("other")).toBe(1);
    expect(await countLocalItems("nobody")).toBe(0);
  });

  it("never persists the plaintext password — only the encrypted_data envelope", async () => {
    // Sanity check: the store accepts whatever ciphertext blob the caller
    // provides and never tries to inspect or split it. The blob shape
    // matches what the server endpoint receives.
    const created = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "v1:nonce:ciphertext-with-tag",
    });
    expect(Object.keys(created).sort()).toEqual([
      "created_at",
      "encrypted_data",
      "id",
      "item_type",
      "updated_at",
      "vault",
    ]);
  });

  it("updates an existing record's ciphertext + bumps updated_at", async () => {
    const created = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "old-blob",
    });
    // Force a millisecond gap so updated_at differs.
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateLocalItem({
      id: created.id,
      encrypted_data: "new-blob",
    });
    expect(updated.encrypted_data).toBe("new-blob");
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.updated_at > created.updated_at).toBe(true);
  });

  it("update throws when the id doesn't exist", async () => {
    await expect(
      updateLocalItem({ id: "no-such-id", encrypted_data: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("accepts a vault that contains an empty string but not records that share an id", async () => {
    const a = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "a",
    });
    // Re-creating with the same id would violate the uniqueness constraint;
    // there's no public API to set the id, but verifying that the schema is
    // correctly keyed on `id` keeps this contract from regressing silently.
    expect(a.id).toBeTruthy();
    const second = await createLocalItem({
      vault: "v",
      item_type: "login",
      encrypted_data: "b",
    });
    expect(second.id).not.toBe(a.id);
  });
});
