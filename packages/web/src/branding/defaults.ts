import type { Branding } from "./types.js";

/**
 * Default brand identity. These are the values an unbranded `passman` ships
 * with and the fallback when `branding.json` is missing, malformed, or fails
 * to fetch. Anything left out of an operator's `branding.json` falls through
 * to these.
 *
 * Hex colour values mirror the design tokens in `styles.css`. Keep them in
 * sync — the loader writes the `--brand` / `--brand-2` CSS variables at
 * runtime, but the rest of the design system is defined in CSS.
 */
export const DEFAULT_BRANDING: Branding = Object.freeze({
  appName: "Passman",
  tagline: "Zero-knowledge password manager",
  logoUrl: "",
  brandColor: "#3ECF8E",
  brandColorDark: "#14B884",
  supportEmail: "",
  footerText: "",
});
