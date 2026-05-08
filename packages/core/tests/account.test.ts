/**
 * End-to-end zero-knowledge tests.
 *
 * These simulate the full register → login → unlock → encrypt → decrypt flow
 * and verify the *security invariants* of the design:
 *   1. The wire payload sent to the server contains no plaintext data.
 *   2. The auth_key, encrypted_symmetric_key, and ciphertext can be sent
 *      to a hostile server and still leak nothing — recovering plaintext
 *      requires the password.
 *   3. A wrong password fails to unlock the vault.
 */
import { describe, expect, it } from "vitest";

import {
  buildRegistration,
  decryptVaultLogin,
  deriveLoginAuthKey,
  encryptVaultLogin,
  unlock,
} from "../src/account.js";
import type { KdfParams, VaultLoginPlaintext } from "../src/types.js";

// Speed: use minimum Argon2 params permitted by the KDF wrapper.
const FAST = {
  timeCost: 2,
  memoryCost: 19_456,
  parallelism: 1,
};

describe("zero-knowledge flow", () => {
  it("end-to-end: register → login → encrypt → decrypt", async () => {
    const email = "alice@example.com";
    const password = "correct-horse-battery-staple";

    // 1. Client builds registration.
    const reg = await buildRegistration(email, password, FAST);

    // Sanity: nothing identifying the password should be in the registration.
    expect(reg.email).toBe(email);
    expect(reg.authKey.length).toBeGreaterThanOrEqual(32);
    expect(reg.encryptedSymmetricKey.startsWith("v1:")).toBe(true);
    // The salt and KDF params are public, the auth_key is one-way derived.
    // Master password and master key MUST NOT appear anywhere in the payload.
    const wireString = JSON.stringify(reg);
    expect(wireString.includes(password)).toBe(false);

    // 2. Login: re-derive the auth_key. (Server then verifies it.)
    const kdfParams: KdfParams = {
      salt: reg.kdfSalt,
      timeCost: reg.kdfTimeCost,
      memoryCost: reg.kdfMemoryCost,
      parallelism: reg.kdfParallelism,
    };
    const authAtLogin = await deriveLoginAuthKey(password, kdfParams);
    expect(authAtLogin).toBe(reg.authKey);

    // 3. Server returns encryptedSymmetricKey; client unlocks with password.
    const session = await unlock(password, kdfParams, reg.encryptedSymmetricKey);

    // 4. Encrypt and decrypt a vault item.
    const item: VaultLoginPlaintext = {
      name: "GitHub",
      username: "alice",
      password: "hunter2",
      url: "https://github.com",
    };
    const encoded = await encryptVaultLogin(item, session);
    expect(encoded.itemType).toBe("login");
    expect(encoded.encryptedData.startsWith("v1:")).toBe(true);
    // Plaintext must not appear in the wire blob.
    expect(encoded.encryptedData.includes("hunter2")).toBe(false);
    expect(encoded.encryptedData.includes("alice")).toBe(false);

    const back = await decryptVaultLogin(encoded.encryptedData, session);
    expect(back).toEqual(item);
  }, 60_000);

  it("wrong password cannot unlock the vault (GCM tag fails)", async () => {
    const reg = await buildRegistration("bob@example.com", "right-password-1", FAST);
    const kdfParams: KdfParams = {
      salt: reg.kdfSalt,
      timeCost: reg.kdfTimeCost,
      memoryCost: reg.kdfMemoryCost,
      parallelism: reg.kdfParallelism,
    };
    await expect(
      unlock("wrong-password-1", kdfParams, reg.encryptedSymmetricKey),
    ).rejects.toBeDefined();
  }, 60_000);

  it("an attacker with only the wire payload cannot extract plaintext", async () => {
    const reg = await buildRegistration("eve@example.com", "victim-password", FAST);
    // Simulate the server's view: it only has reg + ciphertext from items.
    const kdfParams: KdfParams = {
      salt: reg.kdfSalt,
      timeCost: reg.kdfTimeCost,
      memoryCost: reg.kdfMemoryCost,
      parallelism: reg.kdfParallelism,
    };
    const session = await unlock("victim-password", kdfParams, reg.encryptedSymmetricKey);
    const item = await encryptVaultLogin(
      {
        name: "Bank",
        username: "victim",
        password: "super-secret",
      },
      session,
    );
    // Pretend an attacker grabs everything stored on the server.
    const stolen = {
      ...reg,
      ciphertext: item.encryptedData,
    };
    const haystack = JSON.stringify(stolen);
    expect(haystack.includes("victim-password")).toBe(false);
    expect(haystack.includes("super-secret")).toBe(false);
    // They also can't unlock without the password.
    await expect(
      unlock("guess-1", kdfParams, reg.encryptedSymmetricKey),
    ).rejects.toBeDefined();
  }, 60_000);
});
