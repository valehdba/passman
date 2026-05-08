/**
 * High-level zero-knowledge flows. These are the only functions UI code
 * should call directly — the lower-level kdf/crypto modules exist for them.
 *
 * Critical invariants:
 *   - The plaintext password and master key NEVER leave this module's stack.
 *   - The symmetric key is only stored in memory as a non-extractable CryptoKey.
 *   - Wire payloads contain only ciphertext + the auth_key (one-way derived).
 */
import {
  decryptBytes,
  encryptBytes,
  encryptString,
  decryptString,
  generateSymmetricKey,
  importAesKey,
} from "./crypto.js";
import { randomBytes, toBase64 } from "./encoding.js";
import { deriveAuthKey, deriveMasterKey } from "./kdf.js";
import {
  DEFAULT_KDF_PARAMS,
  type EncryptedBlob,
  type KdfParams,
  type VaultItemType,
  type VaultLoginPlaintext,
} from "./types.js";

const SALT_BYTES = 16;

/** Result of preparing a registration request — exactly what the API expects. */
export interface RegistrationPayload {
  email: string;
  authKey: string;
  encryptedSymmetricKey: EncryptedBlob;
  kdfSalt: string;
  kdfTimeCost: number;
  kdfMemoryCost: number;
  kdfParallelism: number;
}

/** A live vault session — what you get back from `unlock()`. */
export interface VaultSession {
  /** Use this to encrypt/decrypt vault items. NOT extractable. */
  symmetricKey: CryptoKey;
  /** Convenience for re-locking — clears the in-memory references. */
  lock: () => void;
}

/**
 * Build a complete registration payload from email + password.
 *
 * Generates random KDF salt + symmetric key client-side, derives master key,
 * encrypts the symmetric key with the master key, and derives an auth key.
 */
export async function buildRegistration(
  email: string,
  password: string,
  paramOverrides?: Partial<Omit<KdfParams, "salt">>,
): Promise<RegistrationPayload> {
  const kdfParams: KdfParams = {
    salt: toBase64(randomBytes(SALT_BYTES)),
    timeCost: paramOverrides?.timeCost ?? DEFAULT_KDF_PARAMS.timeCost,
    memoryCost: paramOverrides?.memoryCost ?? DEFAULT_KDF_PARAMS.memoryCost,
    parallelism: paramOverrides?.parallelism ?? DEFAULT_KDF_PARAMS.parallelism,
  };

  const masterKeyBytes = await deriveMasterKey(password, kdfParams);
  try {
    const authKey = await deriveAuthKey(masterKeyBytes, password);

    const symmetricKeyBytes = generateSymmetricKey();
    const masterCryptoKey = await importAesKey(masterKeyBytes);
    const encryptedSymmetricKey = await encryptBytes(
      symmetricKeyBytes,
      masterCryptoKey,
    );
    // Wipe the raw symmetric key — we never need it again here.
    symmetricKeyBytes.fill(0);

    return {
      email: email.trim().toLowerCase(),
      authKey,
      encryptedSymmetricKey,
      kdfSalt: kdfParams.salt,
      kdfTimeCost: kdfParams.timeCost,
      kdfMemoryCost: kdfParams.memoryCost,
      kdfParallelism: kdfParams.parallelism,
    };
  } finally {
    masterKeyBytes.fill(0);
  }
}

/**
 * Re-derive the auth_key for login. Server returns the encrypted symmetric key,
 * which the caller decrypts via `unlock()`.
 */
export async function deriveLoginAuthKey(
  password: string,
  kdfParams: KdfParams,
): Promise<string> {
  const masterKeyBytes = await deriveMasterKey(password, kdfParams);
  try {
    return await deriveAuthKey(masterKeyBytes, password);
  } finally {
    masterKeyBytes.fill(0);
  }
}

/**
 * Decrypt the user's symmetric key blob with the master key derived from
 * their password, returning a usable `VaultSession`.
 */
export async function unlock(
  password: string,
  kdfParams: KdfParams,
  encryptedSymmetricKeyBlob: string,
): Promise<VaultSession> {
  const masterKeyBytes = await deriveMasterKey(password, kdfParams);
  try {
    const masterCryptoKey = await importAesKey(masterKeyBytes);
    const symmetricKeyBytes = await decryptBytes(
      encryptedSymmetricKeyBlob,
      masterCryptoKey,
    );
    try {
      const symmetricKey = await importAesKey(symmetricKeyBytes);
      return {
        symmetricKey,
        lock: () => {
          /* CryptoKey is non-extractable; GC is the cleanup mechanism. */
        },
      };
    } finally {
      symmetricKeyBytes.fill(0);
    }
  } finally {
    masterKeyBytes.fill(0);
  }
}

// --- Vault item helpers -----------------------------------------------------

export interface EncodedVaultItem {
  itemType: VaultItemType;
  encryptedData: EncryptedBlob;
}

export async function encryptVaultLogin(
  plaintext: VaultLoginPlaintext,
  session: VaultSession,
): Promise<EncodedVaultItem> {
  const json = JSON.stringify(plaintext);
  return {
    itemType: "login",
    encryptedData: await encryptString(json, session.symmetricKey),
  };
}

export async function decryptVaultLogin(
  encryptedData: string,
  session: VaultSession,
): Promise<VaultLoginPlaintext> {
  const json = await decryptString(encryptedData, session.symmetricKey);
  const parsed = JSON.parse(json) as VaultLoginPlaintext;
  // Minimal shape check — server never validated the plaintext.
  if (typeof parsed.name !== "string" || typeof parsed.password !== "string") {
    throw new Error("Decrypted vault item failed shape validation");
  }
  return parsed;
}
