import type { VaultLoginPlaintext } from "@passman/core";

import { parseCsv } from "./csv.js";

/**
 * Bitwarden's "Bitwarden (csv)" export format. Header columns vary slightly
 * across versions; we look up by name (case-insensitive), not column index,
 * so newer/older exports both parse cleanly. Folders and unknown columns
 * are silently dropped.
 *
 * The columns we care about (from a 2024 Bitwarden web vault export):
 *   folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,
 *   login_password,login_totp
 *
 * Items with `type` other than "login" are skipped — Passman only stores
 * login records today.
 */

export interface ImportCandidate {
  plaintext: VaultLoginPlaintext;
  /** Source row index (1-based, header excluded) — used for error messages. */
  sourceRow: number;
}

export interface ImportResult {
  candidates: ImportCandidate[];
  /** Rows we couldn't or wouldn't import, with a reason. */
  skipped: { sourceRow: number; reason: string }[];
}

export function parseBitwardenCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { candidates: [], skipped: [] };
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iType = idx("type");
  const iName = idx("name");
  const iNotes = idx("notes");
  const iUri = idx("login_uri");
  const iUser = idx("login_username");
  const iPw = idx("login_password");
  const iTotp = idx("login_totp");

  if (iName === -1 || iPw === -1) {
    // Best-effort — if name + password aren't present this isn't a Bitwarden CSV.
    return {
      candidates: [],
      skipped: [
        {
          sourceRow: 0,
          reason:
            "Missing required columns. Expected 'name' and 'login_password' (Bitwarden CSV format).",
        },
      ],
    };
  }

  const candidates: ImportCandidate[] = [];
  const skipped: { sourceRow: number; reason: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const cell = (col: number) => (col >= 0 && col < r.length ? r[col]! : "");
    const type = (cell(iType) || "login").toLowerCase();
    if (type !== "login" && type !== "1") {
      skipped.push({
        sourceRow: i,
        reason: `Skipped non-login item (type="${type}")`,
      });
      continue;
    }
    const name = cell(iName).trim();
    if (!name) {
      skipped.push({ sourceRow: i, reason: "Missing name" });
      continue;
    }
    const password = cell(iPw);
    if (!password) {
      skipped.push({ sourceRow: i, reason: `Skipped "${name}" — empty password` });
      continue;
    }
    const username = cell(iUser);
    const url = cell(iUri).trim();
    const notes = cell(iNotes);
    const totp = cell(iTotp).trim();

    const plaintext: VaultLoginPlaintext = {
      name,
      username,
      password,
      ...(url ? { url } : {}),
      ...(notes ? { notes } : {}),
      ...(totp ? { totp } : {}),
    };
    candidates.push({ plaintext, sourceRow: i });
  }

  return { candidates, skipped };
}
