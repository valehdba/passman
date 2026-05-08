/**
 * In-memory session store.
 *
 * IMPORTANT: nothing sensitive is persisted to localStorage. Refresh tokens
 * could go in an httpOnly cookie in a production deployment; here we keep
 * everything in memory so a closed tab = locked vault.
 */
import { create } from "zustand";

import type { VaultSession } from "@passman/core";

interface SessionState {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  vault: VaultSession | null;

  setSession: (s: {
    email: string;
    accessToken: string;
    refreshToken: string;
    vault: VaultSession;
  }) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  email: null,
  accessToken: null,
  refreshToken: null,
  vault: null,
  setSession: (s) =>
    set({
      email: s.email,
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      vault: s.vault,
    }),
  clear: () => {
    // Calling vault.lock() doesn't actually erase memory (CryptoKey is opaque)
    // but it signals intent and we drop the reference for GC.
    set((prev) => {
      prev.vault?.lock();
      return {
        email: null,
        accessToken: null,
        refreshToken: null,
        vault: null,
      };
    });
  },
}));
