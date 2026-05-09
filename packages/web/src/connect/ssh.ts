import type { VaultLoginPlaintext } from "@passman/core";

/**
 * Build an `ssh://user@host:port` URL the OS routes to the default terminal
 * (iTerm/Terminal/Windows Terminal/Konsole). Returns null when there's no
 * host. The password is NEVER part of the URL — SSH clients reject `:pw@`
 * URLs and many handlers drop the segment outright.
 */
export function buildSshUrl(item: VaultLoginPlaintext): string | null {
  const host = item.hostname || item.ip;
  if (!host) return null;
  const user = item.username ? `${encodeURIComponent(item.username)}@` : "";
  const port = item.port && item.port !== 22 ? `:${item.port}` : "";
  return `ssh://${user}${host}${port}`;
}

/**
 * Trigger the OS's `ssh://` handler. Some browsers gate this behind a user
 * prompt the first time — that's fine, that prompt only fires once per
 * origin/scheme.
 *
 * Implementation notes: assigning `location.href` to a custom-scheme URL is
 * unreliable in Chromium — if no handler is registered, Chrome navigates the
 * tab to an "ERR_UNKNOWN_URL_SCHEME" error page, throwing the user out of
 * the app. The synthetic-anchor-click pattern below is what 1Password and
 * Bitwarden use: the click handler invokes the protocol handler if present
 * and is a silent no-op otherwise.
 */
export function launchSshUrl(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
