/**
 * Clipboard helper with a self-clearing timer. Mirrors the behaviour of
 * 1Password / KeePassXC: a sensitive value is on the clipboard for a fixed
 * window, after which we overwrite it (best-effort — we can't actually clear
 * a clipboard the user has since copied something else into).
 */

export const CLIPBOARD_CLEAR_MS = 30_000;

let pendingClear: { token: number; expected: string } | null = null;

/**
 * Copy `text` to the clipboard, then schedule a clear after
 * `clearAfterMs` (default 30 s). If the clipboard contents have been
 * replaced by anything else by the time the timer fires, we leave them
 * alone (the user copied something on purpose).
 *
 * Calling again before the timer fires cancels the previous clear.
 */
export async function copySensitive(
  text: string,
  clearAfterMs = CLIPBOARD_CLEAR_MS,
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
