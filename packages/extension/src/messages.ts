/**
 * Typed message contracts between content script ↔ background service worker.
 *
 * The content script never holds the symmetric key — it only requests
 * matching credentials and gets back already-decrypted plaintext at fill time.
 */

export type Message =
  | { kind: "vault:status" }
  | { kind: "vault:matches"; origin: string }
  | { kind: "vault:reveal"; itemId: string }
  | { kind: "vault:unlock"; email: string; password: string }
  | { kind: "vault:lock" };

export type Response =
  | { kind: "status"; locked: boolean; email: string | null }
  | {
      kind: "matches";
      items: Array<{ id: string; name: string; username: string }>;
    }
  | { kind: "credentials"; username: string; password: string }
  | { kind: "ok"; ok: true }
  | { kind: "error"; ok?: false; message: string; error?: string };
