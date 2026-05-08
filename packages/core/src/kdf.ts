/**
 * Argon2id key derivation — the heart of the zero-knowledge design.
 *
 *   masterKey  = Argon2id(password, kdfSalt, params)         [client-only, never leaves device]
 *   authKey    = Argon2id(masterKey, password,  cheapParams) [sent to server for login]
 *
 * The two derivations are independent one-way functions. Knowing `authKey`
 * does not let an attacker recover `masterKey` or the password without
 * brute-forcing Argon2id.
 *
 * Uses `hash-wasm` (WebAssembly) — runs in browsers, extensions, Node 20+.
 */
import { argon2id } from "hash-wasm";

import { fromBase64, toBase64, utf8Encode } from "./encoding.js";
import type { KdfParams } from "./types.js";

const HASH_LENGTH_BYTES = 32; // 256-bit master/auth keys

/**
 * Derive the master key from a password + per-user salt.
 * MUST be called client-side only. The result must NEVER be sent to the server.
 */
export async function deriveMasterKey(
  password: string,
  params: KdfParams,
): Promise<Uint8Array> {
  if (password.length < 8) {
    // Defense in depth — UI should also enforce this.
    throw new Error("Master password must be at least 8 characters");
  }
  const salt = fromBase64(params.salt);
  if (salt.length < 8) {
    throw new Error("KDF salt is too short (minimum 8 bytes)");
  }
  const result = await argon2id({
    password: utf8Encode(password),
    salt,
    iterations: params.timeCost,
    memorySize: params.memoryCost,
    parallelism: params.parallelism,
    hashLength: HASH_LENGTH_BYTES,
    outputType: "binary",
  });
  return result as Uint8Array;
}

/**
 * Derive the auth key — what the server stores a hash of and uses to verify login.
 *
 * We derive from the master key with the password as salt. The cost can be
 * lower because the input (master key) is already 256 bits of high entropy:
 * pre-image attacks against Argon2id with such inputs are infeasible.
 */
export async function deriveAuthKey(
  masterKey: Uint8Array,
  password: string,
): Promise<string> {
  const result = await argon2id({
    password: masterKey,
    salt: utf8Encode(password),
    iterations: 2,
    memorySize: 19_456, // 19 MiB — RFC 9106 minimum
    parallelism: 1,
    hashLength: HASH_LENGTH_BYTES,
    outputType: "binary",
  });
  // Server treats this as opaque base64 — it's hashed again server-side with Argon2.
  return toBase64(result as Uint8Array);
}
