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
 * origin/scheme. We use `location.href` (rather than a `<a target="_blank">`)
 * so the navigation stays in the existing tab.
 */
export function launchSshUrl(url: string): void {
  // Assigning to location.href triggers the protocol handler without
  // creating an extra history entry that the user would have to back out of.
  window.location.href = url;
}
