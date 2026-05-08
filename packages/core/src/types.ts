/**
 * Shared types for the zero-knowledge crypto layer.
 *
 * Naming convention:
 * - `*Bytes`   = Uint8Array of raw bytes (kept in memory only)
 * - `*B64`     = base64 string (safe to send over wire / store)
 * - `*Blob`    = composite "v1:<iv-b64>:<ciphertext-b64>" string
 */

/** Argon2id parameters. Stored per user, returned by the server pre-login. */
export interface KdfParams {
  /** base64-encoded random salt (>= 16 bytes recommended). */
  salt: string;
  /** Argon2 time cost (iterations). */
  timeCost: number;
  /** Argon2 memory cost in KiB. */
  memoryCost: number;
  /** Argon2 parallelism (lanes). */
  parallelism: number;
}

/** Default client KDF params — must match server's `client_argon2_*` settings. */
export const DEFAULT_KDF_PARAMS: Omit<KdfParams, "salt"> = Object.freeze({
  timeCost: 3,
  memoryCost: 65_536, // 64 MiB
  parallelism: 4,
});

/** Plaintext schema for a stored login (encrypted before the server ever sees it). */
export interface VaultLoginPlaintext {
  name: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  /** otpauth:// URI for TOTP, optional. */
  totp?: string;
}

export type VaultItemType = "login" | "note" | "card" | "identity";

/** Serialized envelope: "v<n>:<iv-b64>:<ciphertext-b64>". */
export type EncryptedBlob = string & { readonly __brand: "EncryptedBlob" };

export const BLOB_VERSION = 1;
