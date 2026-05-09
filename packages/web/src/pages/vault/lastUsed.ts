/**
 * Tracks "last used" timestamps per credential id in localStorage.
 *
 * Stored locally only — never sent to the server. The data is metadata about
 * usage patterns; we keep it on-device by design (matches the zero-knowledge
 * posture of the rest of the product). Survives across page refreshes within
 * the same browser, but does NOT sync across devices for the same user.
 */

const STORAGE_KEY = "passman.lastUsed.v1";

type Map = Record<string, number>;

function load(): Map {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Map;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(map: Map): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage may be disabled in private mode — silently ignore */
  }
}

export function markUsed(id: string): void {
  const map = load();
  map[id] = Date.now();
  save(map);
}

export function getLastUsed(id: string): number | undefined {
  return load()[id];
}

export function getAllLastUsed(): Map {
  return load();
}

/** Format a timestamp as a short relative string ("2m ago", "yesterday"). */
export function formatRelative(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return "—";
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}
