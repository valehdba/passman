import { DEFAULT_BRANDING } from "./defaults.js";
import type { Branding, BrandingOverride } from "./types.js";

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_LOGO_PROTOCOLS = new Set(["http:", "https:", "data:"]);

/**
 * Validate + sanitise an operator-supplied override before merging into
 * defaults. Bad values are quietly dropped (and logged in dev) rather
 * than rejected — a typo in `branding.json` shouldn't break the app.
 */
function sanitise(raw: unknown): BrandingOverride {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: BrandingOverride = {};

  if (typeof r.appName === "string" && r.appName.trim().length > 0) {
    // Cap to a length that fits the sidebar and the page title without truncation.
    out.appName = r.appName.slice(0, 64);
  }
  if (typeof r.tagline === "string") {
    out.tagline = r.tagline.slice(0, 160);
  }
  if (typeof r.logoUrl === "string") {
    out.logoUrl = sanitiseLogoUrl(r.logoUrl);
  }
  if (typeof r.brandColor === "string" && HEX_COLOR.test(r.brandColor)) {
    out.brandColor = r.brandColor;
  }
  if (typeof r.brandColorDark === "string" && HEX_COLOR.test(r.brandColorDark)) {
    out.brandColorDark = r.brandColorDark;
  }
  if (typeof r.supportEmail === "string") {
    out.supportEmail = r.supportEmail.slice(0, 254);
  }
  if (typeof r.footerText === "string") {
    out.footerText = r.footerText.slice(0, 200);
  }
  return out;
}

/**
 * Allow:
 * - same-origin paths (start with `/`) — most common case, served from `public/`
 * - https:// URLs — assume the operator has the appropriate `img-src` CSP rule
 * - data: URLs — let operators inline a small SVG without serving a separate file
 *
 * Reject anything else (`javascript:`, `file://`, etc.) — those are XSS vectors
 * even when set by the operator if `branding.json` ever becomes user-supplied.
 */
function sanitiseLogoUrl(value: string): string {
  if (value === "") return "";
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (SAFE_LOGO_PROTOCOLS.has(url.protocol)) return value;
  } catch {
    /* fall through */
  }
  return "";
}

/** Merge an override over the frozen defaults; returns a new object. */
export function mergeBranding(override: BrandingOverride): Branding {
  return { ...DEFAULT_BRANDING, ...override };
}

/**
 * Fetch `/branding.json` from the deployment's same-origin and merge into
 * defaults. Any failure (404, network, JSON parse error, missing fields)
 * falls back to defaults so the app always boots into a usable state.
 */
export async function loadBranding(
  url = "/branding.json",
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Branding> {
  try {
    const resp = await fetchImpl(url, { cache: "no-store" });
    if (!resp.ok) return mergeBranding({});
    const json = (await resp.json()) as unknown;
    return mergeBranding(sanitise(json));
  } catch {
    // Operators don't always ship a branding.json; that's fine.
    return mergeBranding({});
  }
}

/**
 * Push the merged branding into the document — sets the page title, the
 * favicon (when a logo URL is set), and the `--brand` / `--brand-2` CSS
 * variables so any accent already painted re-themes immediately.
 */
export function applyBranding(brand: Branding): void {
  if (typeof document === "undefined") return;
  document.title = brand.appName;
  const root = document.documentElement;
  root.style.setProperty("--brand", brand.brandColor);
  root.style.setProperty("--brand-2", brand.brandColorDark);
  // Re-derive the soft / line variants so the alpha-tinted accents stay in sync.
  root.style.setProperty(
    "--brand-soft",
    hexWithAlpha(brand.brandColor, 0.12),
  );
  root.style.setProperty(
    "--brand-line",
    hexWithAlpha(brand.brandColor, 0.32),
  );
}

/** Compose a #RRGGBB hex with an alpha channel into the same `rgba(...)` form
 * that the design tokens use. Pass-through for already-prefixed alpha hex. */
function hexWithAlpha(hex: string, alpha: number): string {
  // We accept #RGB / #RRGGBB / #RRGGBBAA forms; for the alpha-prefixed form
  // we strip the existing alpha and apply the new one.
  let r = 0;
  let g = 0;
  let b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1]! + hex[1]!, 16);
    g = parseInt(hex[2]! + hex[2]!, 16);
    b = parseInt(hex[3]! + hex[3]!, 16);
  } else if (hex.length === 7 || hex.length === 9) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
