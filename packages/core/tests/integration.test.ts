/**
 * Integration test: TS client uses @passman/core to talk to a real running
 * server. Skipped unless PASSMAN_INTEGRATION_URL is set — CI sets this when
 * the server-up step succeeds.
 */
import { describe, expect, it } from "vitest";

import {
  buildRegistration,
  decryptVaultLogin,
  deriveLoginAuthKey,
  encryptVaultLogin,
  unlock,
} from "../src/account.js";
import type { KdfParams } from "../src/types.js";

const baseUrl = process.env.PASSMAN_INTEGRATION_URL;
const FAST = { timeCost: 2, memoryCost: 19_456, parallelism: 1 };

const maybeDescribe = baseUrl ? describe : describe.skip;

maybeDescribe("end-to-end against live server", () => {
  it("register → login → create item → list → decrypt", async () => {
    const email = `it-${crypto.randomUUID()}@example.com`;
    const password = "integration-password-strong-1";

    const reg = await buildRegistration(email, password, FAST);

    // Register
    const regResp = await fetch(`${baseUrl}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: reg.email,
        auth_key: reg.authKey,
        encrypted_symmetric_key: reg.encryptedSymmetricKey,
        kdf_salt: reg.kdfSalt,
        kdf_time_cost: reg.kdfTimeCost,
        kdf_memory_cost: reg.kdfMemoryCost,
        kdf_parallelism: reg.kdfParallelism,
      }),
    });
    expect(regResp.status).toBe(201);

    // Pre-login: fetch KDF params
    const kdfResp = await fetch(
      `${baseUrl}/api/accounts/kdf?email=${encodeURIComponent(email)}`,
    );
    expect(kdfResp.status).toBe(200);
    const kdfBody = (await kdfResp.json()) as {
      kdf_salt: string;
      kdf_time_cost: number;
      kdf_memory_cost: number;
      kdf_parallelism: number;
    };
    const kdfParams: KdfParams = {
      salt: kdfBody.kdf_salt,
      timeCost: kdfBody.kdf_time_cost,
      memoryCost: kdfBody.kdf_memory_cost,
      parallelism: kdfBody.kdf_parallelism,
    };

    // Derive auth_key for login
    const authKey = await deriveLoginAuthKey(password, kdfParams);
    const loginResp = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, auth_key: authKey }),
    });
    expect(loginResp.status).toBe(201);
    const session = (await loginResp.json()) as {
      access_token: string;
      encrypted_symmetric_key: string;
    };

    // Unlock vault locally
    const vault = await unlock(password, kdfParams, session.encrypted_symmetric_key);

    // Create encrypted item
    const item = await encryptVaultLogin(
      { name: "Test", username: "u", password: "p", url: "https://x.example" },
      vault,
    );
    const createResp = await fetch(`${baseUrl}/api/vault/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        item_type: item.itemType,
        encrypted_data: item.encryptedData,
      }),
    });
    expect(createResp.status).toBe(201);

    // List + decrypt
    const listResp = await fetch(`${baseUrl}/api/vault/items`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as {
      items: Array<{ encrypted_data: string }>;
    };
    expect(listBody.items.length).toBe(1);
    const decrypted = await decryptVaultLogin(
      listBody.items[0]!.encrypted_data,
      vault,
    );
    expect(decrypted.password).toBe("p");
  }, 60_000);
});
