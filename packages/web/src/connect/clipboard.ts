/**
 * Clipboard helper with a self-clearing timer. Mirrors the behaviour of
 * 1Password / KeePassXC: a sensitive value is on the clipboard for a fixed
 * window, after which we overwrite it (best-effort — we can't actually clear
 * a clipboard the user has since copied something else into).
 */

import { getPreferences } from "../stores/preferences.js";

/** Fallback clear window; the user's preference (Settings) overrides it. */
export const CLIPBOARD_CLEAR_MS = 30_000;

let pendingClear: { token: number; expected: string } | null = null;

/**
 * Copy `text` to the clipboard, then schedule a clear after
 * `clearAfterMs` (default: the user's clipboard preference, 30 s out of the box;
 * 0 = never clear). If the clipboard contents have been
 * replaced by anything else by the time the timer fires, we leave them
 * alone (the user copied something on purpose).
 *
 * Calling again before the timer fires cancels the previous clear.
 */
export async function copySensitive(
  text: string,
  clearAfterMs = getPreferences().clipboardClearSeconds * 1000,
): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (pendingClear !== null) {
    window.clearTimeout(pendingClear.token);
    pendingClear = null;
  }
  if (clearAfterMs <= 0) return;
  const expected = text;
  const token = window.setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === expected) {
        await navigator.clipboard.writeText("");
      }
    } catch {
      // Reading the clipboard requires permission in some browsers; fall back
      // to overwriting unconditionally. That's safer than leaving a secret
      // hanging around.
      try {
        await navigator.clipboard.writeText("");
      } catch {
        /* nothing more we can do */
      }
    } finally {
      pendingClear = null;
    }
  }, clearAfterMs);
  pendingClear = { token, expected };
}

/** Copy a non-sensitive string (no auto-clear). */
export async function copyPlain(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Human text for toasts: "clears in 30 s" / "clears in 2 min" / "does not auto-clear". */
export function clipboardClearLabel(): string {
  const sec = getPreferences().clipboardClearSeconds;
  if (sec <= 0) return "does not auto-clear";
  return sec % 60 === 0 && sec >= 120 ? `clears in ${sec / 60} min` : `clears in ${sec} s`;
}
