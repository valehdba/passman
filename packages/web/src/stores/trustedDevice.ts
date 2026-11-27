/**
 * Remembers the "trusted device" token the server issued after an OTP step
 * completed with "Trust this device", so the next login on this browser can
 * skip the OTP prompt until the trust expires.
 *
 * The token only skips the second factor — the master password is always
 * required. It is stored per email in localStorage; clearing site data (or
 * revoking it in Settings → Trusted devices) makes the OTP prompt return.
 */

export const TRUST_STORAGE_KEY = "passman.trusted-devices.v1";

interface Entry {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

type Store = Record<string, Entry>;

const norm = (email: string) => email.trim().toLowerCase();

function read(): Store {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(TRUST_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<Entry> | null;
      if (e && typeof e.token === "string" && typeof e.expiresAt === "number") {
        out[k] = { token: e.token, expiresAt: e.expiresAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(s: Store): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* blocked/full: trust just won't persist */
  }
}

/** The unexpired token for this email, or null (expired entries are dropped). */
export function getTrustToken(email: string, now = Date.now()): string | null {
  const s = read();
  const e = s[norm(email)];
  if (!e) return null;
  if (e.expiresAt <= now) {
    delete s[norm(email)];
    write(s);
    return null;
  }
  return e.token;
}

export function setTrustToken(
  email: string,
  token: string,
  expiresInSeconds: number,
  now = Date.now(),
): void {
  const s = read();
  s[norm(email)] = { token, expiresAt: now + expiresInSeconds * 1000 };
  write(s);
}

export function clearTrustToken(email: string): void {
  const s = read();
  if (norm(email) in s) {
    delete s[norm(email)];
    write(s);
  }
}

export function clearAllTrustTokens(): void {
  write({});
}
