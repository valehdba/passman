/**
 * Tiny wrapper over the `qrcode` npm library that produces an SVG string
 * for a given otpauth:// URI. Keeping this isolated lets us swap the
 * library later (or hand-roll if bundle weight ever becomes an issue)
 * without touching the React components.
 */
import qrcode from "qrcode";

export interface QrOptions {
  /** Pixel size of the rendered SVG. Default 240 — fits in the setup modal
   *  without stretching, large enough for phone cameras. */
  size?: number;
}

export async function renderOtpauthQr(
  otpauthUri: string,
  options: QrOptions = {},
): Promise<string> {
  const size = options.size ?? 240;
  // The library's `toString` with type "svg" returns inline SVG markup —
  // safe to inject via `dangerouslySetInnerHTML` because the input is a
  // server-controlled string (the otpauth:// URI built from the user's
  // own secret + email).
  return qrcode.toString(otpauthUri, {
    type: "svg",
    margin: 1,
    width: size,
    color: {
      // Match the design tokens — `--bg-deep` and `--brand` couldn't be
      // resolved at runtime here, so we hard-code values. If the brand
      // colour ever needs to flow into QR codes too, swap to a CSS-var
      // resolver.
      dark: "#3ECF8E",
      light: "#0d0f10",
    },
  });
}

/** Format a base32 secret with spaces every 4 chars — easier to read aloud
 *  or paste into apps that don't auto-strip spaces. */
export function formatSecretForDisplay(secretBase32: string): string {
  return (
    secretBase32
      .toUpperCase()
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? secretBase32
  );
}
