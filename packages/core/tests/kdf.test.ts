import { describe, expect, it } from "vitest";

import { deriveAuthKey, deriveMasterKey } from "../src/kdf.js";
import { randomBytes, toBase64 } from "../src/encoding.js";
import type { KdfParams } from "../src/types.js";

// Use the cheapest valid Argon2id params for fast tests.
const fastParams: KdfParams = {
  salt: toBase64(randomBytes(16)),
  timeCost: 2,
  memoryCost: 19_456, // RFC 9106 minimum
  parallelism: 1,
};

describe("KDF", () => {
  it("derives a 32-byte master key", async () => {
    const key = await deriveMasterKey("correct-horse-battery-staple", fastParams);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("is deterministic for same inputs", async () => {
    const a = await deriveMasterKey("password123!", fastParams);
    const b = await deriveMasterKey("password123!", fastParams);
    expect(a).toEqual(b);
  });

  it("differs across passwords", async () => {
    const a = await deriveMasterKey("password-a", fastParams);
    const b = await deriveMasterKey("password-b", fastParams);
    expect(a).not.toEqual(b);
  });

  it("differs across salts", async () => {
    const p2: KdfParams = { ...fastParams, salt: toBase64(randomBytes(16)) };
    const a = await deriveMasterKey("samepassword", fastParams);
    const b = await deriveMasterKey("samepassword", p2);
    expect(a).not.toEqual(b);
  });

  it("rejects too-short passwords", async () => {
    await expect(deriveMasterKey("short", fastParams)).rejects.toThrow();
  });

  it("rejects too-short salts", async () => {
    const bad: KdfParams = { ...fastParams, salt: toBase64(randomBytes(4)) };
    await expect(deriveMasterKey("a-real-password", bad)).rejects.toThrow();
  });

  it("auth key is base64 of 32 bytes", async () => {
    const masterKey = await deriveMasterKey("user-password", fastParams);
    const authKey = await deriveAuthKey(masterKey, "user-password");
    // base64 of 32 bytes = 44 chars (including padding).
    expect(authKey.length).toBe(44);
    // Must be deterministic for the same inputs.
    const again = await deriveAuthKey(masterKey, "user-password");
    expect(authKey).toBe(again);
  });

  it("auth key changes if the password component changes", async () => {
    const masterKey = await deriveMasterKey("a-password", fastParams);
    const k1 = await deriveAuthKey(masterKey, "a-password");
    const k2 = await deriveAuthKey(masterKey, "different-password");
    expect(k1).not.toBe(k2);
  });
}, { timeout: 30_000 });
