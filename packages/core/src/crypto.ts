/**
 * AES-256-GCM authenticated encryption + envelope (de)serialization.
 *
 * Envelope format:  "v<version>:<base64 IV>:<base64 ciphertext+tag>"
 *
 * Each call uses a freshly generated random 96-bit IV — never reuse an IV
 * with the same key (GCM forgery becomes possible if you do).
 */
import { fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode } from "./encoding.js";
import { BLOB_VERSION, type EncryptedBlob } from "./types.js";

const IV_BYTES = 12; // 96 bits — recommended for GCM
const KEY_BYTES = 32; // AES-256

/** Import a raw 32-byte key as a non-extractable AES-GCM CryptoKey. */
export async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.length !== KEY_BYTES) {
    throw new Error(`AES key must be ${KEY_BYTES} bytes, got ${rawKey.length}`);
  }
  return crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}

/** Generate a fresh random 256-bit symmetric key. */
export function generateSymmetricKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/** Encrypt a string and produce a self-describing envelope. */
export async function encryptString(
  plaintext: string,
  key: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      utf8Encode(plaintext) as BufferSource,
    ),
  );
  return `v${BLOB_VERSION}:${toBase64(iv)}:${toBase64(ciphertext)}` as EncryptedBlob;
}

/** Encrypt raw bytes (e.g. the symmetric key itself with the master key). */
export async function encryptBytes(
  data: Uint8Array,
  key: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource,
    ),
  );
  return `v${BLOB_VERSION}:${toBase64(iv)}:${toBase64(ciphertext)}` as EncryptedBlob;
}

interface ParsedEnvelope {
  version: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function parseEnvelope(blob: string): ParsedEnvelope {
  const parts = blob.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted blob");
  }
  const [versionPart, ivB64, ctB64] = parts as [string, string, string];
  if (!versionPart.startsWith("v")) {
    throw new Error("Malformed envelope version");
  }
  const version = Number.parseInt(versionPart.slice(1), 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Unsupported blob version: ${versionPart}`);
  }
  const iv = fromBase64(ivB64);
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }
  return { version, iv, ciphertext: fromBase64(ctB64) };
}

/** Decrypt and return a UTF-8 string. Throws on tag mismatch (data was tampered). */
export async function decryptString(
  blob: string,
  key: CryptoKey,
): Promise<string> {
  const { iv, ciphertext } = parseEnvelope(blob);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    ),
  );
  return utf8Decode(plain);
}

/** Decrypt and return raw bytes. */
export async function decryptBytes(
  blob: string,
  key: CryptoKey,
): Promise<Uint8Array> {
  const { iv, ciphertext } = parseEnvelope(blob);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    ),
  );
}
