import { describe, expect, it } from "vitest";

import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  generateSymmetricKey,
  importAesKey,
} from "../src/crypto.js";
import { fromBase64, randomBytes, toBase64 } from "../src/encoding.js";

async function freshKey() {
  return importAesKey(generateSymmetricKey());
}

describe("AES-GCM crypto", () => {
  it("round-trips strings", async () => {
    const key = await freshKey();
    const cases = ["", "hi", "🌐 üñíçødé", "a".repeat(50_000)];
    for (const plaintext of cases) {
      const blob = await encryptString(plaintext, key);
      expect(blob.startsWith("v1:")).toBe(true);
      expect(await decryptString(blob, key)).toBe(plaintext);
    }
  });

  it("round-trips raw bytes", async () => {
    const key = await freshKey();
    const data = randomBytes(64);
    const blob = await encryptBytes(data, key);
    expect(await decryptBytes(blob, key)).toEqual(data);
  });

  it("uses a fresh IV every time (so identical plaintexts produce different ciphertexts)", async () => {
    const key = await freshKey();
    const a = await encryptString("same", key);
    const b = await encryptString("same", key);
    expect(a).not.toBe(b);
  });

  it("rejects ciphertext encrypted under a different key", async () => {
    const k1 = await freshKey();
    const k2 = await freshKey();
    const blob = await encryptString("secret", k1);
    await expect(decryptString(blob, k2)).rejects.toBeDefined();
  });

  it("rejects tampered ciphertext (GCM tag mismatch)", async () => {
    const key = await freshKey();
    const blob = await encryptString("secret", key);
    // Flip the last base64 char of the ciphertext to invalidate the tag.
    const parts = blob.split(":");
    const ct = parts[2]!;
    const flipped =
      ct.slice(0, -2) + (ct.at(-2) === "A" ? "B" : "A") + ct.slice(-1);
    const tampered = `${parts[0]}:${parts[1]}:${flipped}`;
    await expect(decryptString(tampered, key)).rejects.toBeDefined();
  });

  it("rejects malformed envelopes", async () => {
    const key = await freshKey();
    await expect(decryptString("not-a-blob", key)).rejects.toThrow(/Malformed/);
    await expect(decryptString("v1:onlyTwoParts", key)).rejects.toThrow(/Malformed/);
    await expect(
      decryptString(`v1:${toBase64(randomBytes(8))}:${toBase64(randomBytes(16))}`, key),
    ).rejects.toThrow(/Invalid IV length/);
  });

  it("rejects unsupported envelope versions", async () => {
    const key = await freshKey();
    const iv = toBase64(randomBytes(12));
    const ct = toBase64(randomBytes(16));
    await expect(decryptString(`v0:${iv}:${ct}`, key)).rejects.toThrow();
  });

  it("importAesKey rejects wrong-sized keys", async () => {
    await expect(importAesKey(randomBytes(16))).rejects.toThrow();
    await expect(importAesKey(randomBytes(31))).rejects.toThrow();
  });

  it("imported key is non-extractable", async () => {
    const key = await importAesKey(generateSymmetricKey());
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeDefined();
  });
});
