/**
 * Encoding helpers — base64 + utf-8 + cryptographically-secure random bytes.
 *
 * We avoid Node-only APIs so this file works in browsers, service workers,
 * and Node 20+ (which has a global Web Crypto API).
 */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function utf8Encode(s: string): Uint8Array {
  return enc.encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return dec.decode(b);
}

export function toBase64(bytes: Uint8Array): string {
  // Avoid spread on huge arrays — chunked conversion.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new RangeError(`randomBytes: n must be a positive integer, got ${n}`);
  }
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Constant-time byte comparison. Returns false on length mismatch. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
