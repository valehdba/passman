import type { VaultLoginPlaintext } from "@passman/core";

/**
 * Loose validation for a PEM-encoded private key. We don't try to parse
 * the key — that needs a real ASN.1 / OpenSSH parser — we just check
 * the begin/end marker bracketing so a paste error is caught early.
 *
 * Accepts any of:
 *   -----BEGIN OPENSSH PRIVATE KEY-----
 *   -----BEGIN RSA PRIVATE KEY-----
 *   -----BEGIN EC PRIVATE KEY-----
 *   -----BEGIN PRIVATE KEY-----
 */
const PEM_RE =
  /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----[\s\S]+?-----END \1?PRIVATE KEY-----/;

export function looksLikePem(text: string): boolean {
  if (!text) return false;
  return PEM_RE.test(text.trim());
}

/**
 * Trigger a browser download of the credential's SSH key with mode-0600
 * intent embedded in the filename. Returns false if no key is set.
 */
export function downloadSshKey(item: VaultLoginPlaintext): boolean {
  if (!item.privateKey) return false;
  // Always emit a trailing newline — `ssh -i` and OpenSSH itself reject
  // some keys without one.
  const content = item.privateKey.endsWith("\n")
    ? item.privateKey
    : `${item.privateKey}\n`;
  const blob = new Blob([content], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (item.name || "passman-key").replace(/[^a-zA-Z0-9_-]+/g, "-");
  a.download = `${safeName}.pem`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Build an `ssh -i ~/.ssh/passman/<name>.pem user@host` command for the
 *  copy-command action when a key is attached. */
export function buildSshKeyCommand(item: VaultLoginPlaintext): string | null {
  const host = item.hostname || item.ip;
  if (!host || !item.privateKey) return null;
  const safeName = (item.name || "passman-key").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const userAt = item.username ? `${item.username}@` : "";
  const portArg =
    item.port && item.port !== 22 ? ` -p ${item.port}` : "";
  return `ssh -i ~/.ssh/passman/${safeName}.pem ${userAt}${host}${portArg}`;
}
