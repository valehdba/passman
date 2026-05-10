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

/**
 * Connect protocol declared on a credential. Drives which actions appear in
 * the Connect dialog (JDBC / SSH / RDP / copy-command). Optional — if absent
 * the UI falls back to inferring from the port.
 */
export type Protocol =
  | "ssh"
  | "rdp"
  | "psql"
  | "mysql"
  | "mariadb"
  | "oracle"
  | "mssql"
  | "redis"
  | "mongo"
  | "https"
  | "other";

/** Plaintext schema for a stored login (encrypted before the server ever sees it). */
export interface VaultLoginPlaintext {
  name: string;
  username: string;
  password: string;
  url?: string;
  /** DNS name or short host alias (e.g. "db-prod-01"). */
  hostname?: string;
  /** IPv4 / IPv6 address of the target host. */
  ip?: string;
  /** TCP/UDP port the credential authenticates against (e.g. 5432). */
  port?: number;
  /** Connect protocol — drives the Connect dialog options. */
  protocol?: Protocol;
  /** Database name (Postgres, MySQL, MariaDB, Mongo, SQL Server). */
  database?: string;
  /** Oracle SERVICE_NAME (or SID for legacy `host:port:sid` style). */
  serviceName?: string;
  /** Windows AD domain (RDP only). */
  domain?: string;
  /** Free-form environment label shown as a row tag (e.g. "prod", "staging"). */
  environment?: string;
  /**
   * SSH private key (PEM-encoded). When set the Connect dialog offers a
   * "Use SSH key" action that downloads the key as `<name>.pem`. The blob
   * is encrypted with the same vault key as the rest of the credential —
   * the server never sees its contents.
   */
  privateKey?: string;
  notes?: string;
  /** otpauth:// URI for TOTP, optional. */
  totp?: string;
}

export type VaultItemType = "login" | "note" | "card" | "identity";

/** Serialized envelope: "v<n>:<iv-b64>:<ciphertext-b64>". */
export type EncryptedBlob = string & { readonly __brand: "EncryptedBlob" };

export const BLOB_VERSION = 1;
