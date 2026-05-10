import { describe, expect, it } from "vitest";

import { buildBackup } from "../src/backup/index.js";
import type { LocatedItem } from "../src/storage/index.js";

const item = (over: Partial<LocatedItem> = {}): LocatedItem => ({
  id: over.id ?? "id-1",
  item_type: over.item_type ?? "login",
  encrypted_data: over.encrypted_data ?? "v1:iv:ct",
  location: over.location ?? "server",
  created_at: over.created_at ?? "2026-05-01T00:00:00.000Z",
  updated_at: over.updated_at ?? "2026-05-01T00:00:00.000Z",
});

describe("buildBackup", () => {
  it("produces the v1 backup envelope", () => {
    const out = buildBackup("Alice@Example.AZ", [item()]);
    expect(out.format).toBe("passman-backup");
    expect(out.version).toBe(1);
    expect(out.vault).toBe("alice@example.az");
    expect(out.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.items).toHaveLength(1);
  });

  it("preserves location tags + ciphertext exactly", () => {
    const out = buildBackup("v", [
      item({ id: "a", encrypted_data: "v1:iv:srv", location: "server" }),
      item({ id: "b", encrypted_data: "v1:iv:loc", location: "local" }),
    ]);
    expect(out.items.map((i) => [i.id, i.location, i.encrypted_data])).toEqual([
      ["a", "server", "v1:iv:srv"],
      ["b", "local", "v1:iv:loc"],
    ]);
  });

  it("empty vault produces empty items array", () => {
    expect(buildBackup("v", []).items).toEqual([]);
  });

  it("never embeds plaintext (it operates on already-encrypted blobs)", () => {
    // Sanity check — `buildBackup` never sees the plaintext shape; it only
    // copies the `encrypted_data` field forward. This test fails closed if
    // someone later changes it to JSON-stringify a `plaintext` field.
    const out = JSON.stringify(buildBackup("v", [item()]));
    expect(out).not.toContain("password");
    expect(out).not.toContain("username");
  });
});
