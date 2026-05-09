import { useBranding } from "../../branding/index.js";

/**
 * Logo + app-name pair shown above the auth pages. Mirrors the
 * sidebar's `.brand` element so a customer's logo lands in both
 * places consistently. Falls back to the default gradient mark
 * when no `logoUrl` is configured.
 */
export function BrandHeader() {
  const brand = useBranding();
  return (
    <div className="auth-brand">
      {brand.logoUrl ? (
        <img
          className="brand-logo"
          src={brand.logoUrl}
          alt={`${brand.appName} logo`}
          width={28}
          height={28}
        />
      ) : (
        <div className="brand-mark brand-mark-lg" />
      )}
      <span className="auth-brand-name">{brand.appName}</span>
    </div>
  );
}
