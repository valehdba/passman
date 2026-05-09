/**
 * Runtime branding shape. The web app fetches `/branding.json` on boot and
 * merges its contents over `DEFAULT_BRANDING`. Every field is optional in
 * the on-disk form — operators only override what they want changed, and
 * a missing or malformed `branding.json` falls back to the defaults
 * (existing deployments need zero changes).
 */
export interface Branding {
  /** Product name shown in the sidebar, page title, and login/register heroes. */
  appName: string;
  /** Optional one-liner shown under the appName on the auth pages. */
  tagline: string;
  /**
   * Logo image URL. Same-origin paths (e.g. `/branding/logo.svg`) are
   * preferred — the strict CSP blocks remote images. An empty string
   * shows the default brand mark (a green gradient square).
   */
  logoUrl: string;
  /**
   * Primary brand colour. Applied via the `--brand` CSS variable so it
   * cascades to every accent in the UI (Connect button, focus rings,
   * pill backgrounds, engine-tile borders for missing engine accents).
   */
  brandColor: string;
  /** Darker shade used for hover / gradient stops. Defaults to a darkened brandColor. */
  brandColorDark: string;
  /** Optional support contact shown in error messages and the user card. */
  supportEmail: string;
  /** Optional small text shown in the sidebar footer. Empty hides it. */
  footerText: string;
}

/** Partial-override shape an operator can put in `branding.json`. */
export type BrandingOverride = Partial<Branding>;
