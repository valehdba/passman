import type { VaultLoginPlaintext } from "@passman/core";

import type { LocatedItem, StorageLocation } from "../../storage/index.js";

export type { StorageLocation };

export interface DecryptedItem extends LocatedItem {
  plaintext: VaultLoginPlaintext;
}

/** Keys the user can group by in the sidebar / dropdown. */
export type GroupKey = "none" | "hostname" | "ip" | "username" | "port" | "protocol";

/** Sidebar view filter — predefined views over the full vault. */
export type ViewKey = "all" | "recent" | "favourites";

/** Tag class used for the env pill — narrowed from a free-form string. */
export type EnvClass = "prod" | "staging" | "dev" | "cache" | "default";

/** Map an arbitrary environment string to a known tag class for styling. */
export function envClass(env: string | undefined): EnvClass {
  if (!env) return "default";
  const e = env.toLowerCase();
  if (e.startsWith("prod")) return "prod";
  if (e.startsWith("stag") || e.startsWith("uat") || e.startsWith("test")) return "staging";
  if (e.startsWith("dev") || e.startsWith("local")) return "dev";
  if (e.startsWith("cache")) return "cache";
  return "default";
}
