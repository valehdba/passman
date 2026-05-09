import type { VaultLoginPlaintext } from "@passman/core";

/**
 * Build the contents of a Windows .rdp file for the credential. The format is
 * line-oriented "key:type:value" — Windows native, also supported by
 * Microsoft Remote Desktop on macOS and FreeRDP/Remmina on Linux.
 *
 * The password is NOT embedded — RDP requires DPAPI-encrypted blobs (Windows)
 * or the OS keychain (macOS/Linux), neither of which a browser can produce.
 * The caller copies the password to the clipboard separately so the user can
 * paste it into the credential prompt that pops up on first connect.
 *
 * Returns null when there's no host to connect to.
 */
export function buildRdpFile(item: VaultLoginPlaintext): string | null {
  const host = item.hostname || item.ip;
  if (!host) return null;
  const port = item.port && item.port !== 3389 ? item.port : 3389;
  const fullAddress = `${host}:${port}`;

  // Per-credential username includes optional Windows AD domain.
  const userParts: string[] = [];
  if (item.domain) userParts.push(item.domain);
  const userTail = item.username ?? "";
  const username = userParts.length
    ? `${userParts.join("\\")}\\${userTail}`
    : userTail;

  // Reasonable defaults for a modern RDP session: 32-bit colour, full-screen,
  // local clipboard + drives forwarded. These mirror what the Microsoft
  // Remote Desktop client emits for a fresh "PCs" entry.
  const lines = [
    `full address:s:${fullAddress}`,
    `prompt for credentials:i:1`,
    `username:s:${username}`,
    `screen mode id:i:2`,
    `desktopwidth:i:1920`,
    `desktopheight:i:1080`,
    `session bpp:i:32`,
    `compression:i:1`,
    `keyboardhook:i:2`,
    `audiocapturemode:i:0`,
    `videoplaybackmode:i:1`,
    `connection type:i:7`,
    `networkautodetect:i:1`,
    `bandwidthautodetect:i:1`,
    `displayconnectionbar:i:1`,
    `enableworkspacereconnect:i:0`,
    `disable wallpaper:i:0`,
    `allow font smoothing:i:1`,
    `allow desktop composition:i:1`,
    `disable full window drag:i:1`,
    `disable menu anims:i:1`,
    `disable themes:i:0`,
    `disable cursor setting:i:0`,
    `bitmapcachepersistenable:i:1`,
    `audiomode:i:0`,
    `redirectprinters:i:1`,
    `redirectcomports:i:0`,
    `redirectsmartcards:i:1`,
    `redirectclipboard:i:1`,
    `redirectposdevices:i:0`,
    `autoreconnection enabled:i:1`,
    `authentication level:i:2`,
    `negotiate security layer:i:1`,
    `remoteapplicationmode:i:0`,
    `alternate shell:s:`,
    `shell working directory:s:`,
    `gatewayhostname:s:`,
    `gatewayusagemethod:i:4`,
    `gatewaycredentialssource:i:4`,
    `gatewayprofileusagemethod:i:0`,
    `promptcredentialonce:i:0`,
    `gatewaybrokeringtype:i:0`,
    `use redirection server name:i:0`,
    `rdgiskdcproxy:i:0`,
    `kdcproxyname:s:`,
  ];

  // Per RDP 6+ convention the file is UTF-16LE with a BOM, but text/plain UTF-8
  // also works for every modern client. We use UTF-8 + LF for portability.
  return lines.join("\r\n") + "\r\n";
}

/** Trigger a download of an .rdp file in the user's browser. */
export function downloadRdpFile(item: VaultLoginPlaintext): boolean {
  const content = buildRdpFile(item);
  if (!content) return false;
  const blob = new Blob([content], { type: "application/rdp" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Sanitise filename: keep alphanumerics, dash, underscore.
  const safeName = (item.name || "passman").replace(/[^a-zA-Z0-9_-]+/g, "-");
  a.download = `${safeName}.rdp`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a short delay so the browser has a chance to start the
  // download — instant revoke can race with the click handler on Chromium.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
