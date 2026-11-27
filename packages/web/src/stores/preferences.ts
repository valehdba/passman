/**
 * User preferences — non-sensitive, per-browser, persisted to localStorage.
 *
 * Nothing secret belongs here (see stores/session.ts for the in-memory session).
 * Values read from storage are validated and clamped, so a tampered or stale
 * entry can never put the app into an invalid state.
 */
import { create } from "zustand";

import type { Protocol } from "@passman/core";

export const PREFS_STORAGE_KEY = "passman.preferences.v1";

export const PROTOCOL_VALUES: readonly Protocol[] = [
  "ssh",
  "rdp",
  "psql",
  "mysql",
  "mariadb",
  "oracle",
  "mssql",
  "redis",
  "mongo",
  "https",
];

export interface Preferences {
  /** Lock the vault after this many idle minutes. 0 = never. */
  autoLockMinutes: number;
  /** Clear a copied password from the clipboard after N seconds. 0 = never. */
  clipboardClearSeconds: number;
  /** Protocol pre-selected in the New credential form. "" = none. */
  defaultProtocol: Protocol | "";
}

export const DEFAULT_PREFERENCES: Preferences = {
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  defaultProtocol: "",
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Coerce arbitrary parsed JSON into a valid Preferences object. */
export function sanitizePreferences(raw: unknown): Preferences {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const proto = r.defaultProtocol;
  return {
    autoLockMinutes: clampInt(
      r.autoLockMinutes,
      0,
      24 * 60,
      DEFAULT_PREFERENCES.autoLockMinutes,
    ),
    clipboardClearSeconds: clampInt(
      r.clipboardClearSeconds,
      0,
      3600,
      DEFAULT_PREFERENCES.clipboardClearSeconds,
    ),
    defaultProtocol:
      typeof proto === "string" && (PROTOCOL_VALUES as readonly string[]).includes(proto)
        ? (proto as Protocol)
        : "",
  };
}

function load(): Preferences {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_PREFERENCES };
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    return sanitizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function persist(p: Preferences): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked — preference just won't survive a reload */
  }
}

interface PreferencesState extends Preferences {
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...load(),
  update: (patch) => {
    const { update: _u, reset: _r, ...current } = get();
    const next = sanitizePreferences({ ...current, ...patch });
    persist(next);
    set(next);
  },
  reset: () => {
    persist({ ...DEFAULT_PREFERENCES });
    set({ ...DEFAULT_PREFERENCES });
  },
}));

/** Non-reactive read for plain modules (e.g. the clipboard helper). */
export function getPreferences(): Preferences {
  const { autoLockMinutes, clipboardClearSeconds, defaultProtocol } = usePreferences.getState();
  return { autoLockMinutes, clipboardClearSeconds, defaultProtocol };
}
