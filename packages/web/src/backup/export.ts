/**
 * Backup-export builder.
 *
 * The exported file is plain JSON containing **already-encrypted**
 * ciphertext blobs — the same envelopes the server stores, plus the local
 * IndexedDB items, plus enough metadata for a future Restore flow to know
 * where each item belongs. The user's master password is required to
 * decrypt; it is NOT in the file.
 *
 * Shape (`PassmanBackupV1`):
 *   {
 *     "format": "passman-backup",
 *     "version": 1,
 *     "exportedAt": ISO timestamp,
 *     "vault": "user@example.az",
 *     "items": [
 *       { id, item_type, encrypted_data, location: "server" | "local",
 *         created_at, updated_at }
 *     ]
 *   }
 */
import type { LocatedItem } from "../storage/index.js";

export interface PassmanBackupV1 {
  format: "passman-backup";
  version: 1;
  exportedAt: string;
  vault: string;
  items: Array<{
    id: string;
    item_type: string;
    encrypted_data: string;
    location: "server" | "local";
    created_at: string;
    updated_at: string;
  }>;
}

export function buildBackup(
  vault: string,
  items: LocatedItem[],
): PassmanBackupV1 {
  return {
    format: "passman-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    vault: vault.toLowerCase(),
    items: items.map((it) => ({
      id: it.id,
      item_type: it.item_type,
      encrypted_data: it.encrypted_data,
      location: it.location,
      created_at: it.created_at,
      updated_at: it.updated_at,
    })),
  };
}

/**
 * Serialise the backup as JSON and trigger a browser download. The file
 * is named `passman-<vault>-<YYYYMMDD>.json` with the vault email
 * sanitised to filesystem-safe chars.
 */
export function downloadBackup(backup: PassmanBackupV1): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeVault = backup.vault.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const date = backup.exportedAt.slice(0, 10).replace(/-/g, "");
  a.download = `passman-${safeVault}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
