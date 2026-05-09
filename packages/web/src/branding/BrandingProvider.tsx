import { createContext, useContext, useEffect, useState } from "react";

import { DEFAULT_BRANDING } from "./defaults.js";
import { applyBranding, loadBranding } from "./load.js";
import type { Branding } from "./types.js";

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

interface Props {
  children: React.ReactNode;
}

/**
 * Fetches `/branding.json` once, applies the resulting brand to the
 * document (page title + CSS variables), and exposes the merged branding
 * via React context. Components read it with `useBranding()`.
 *
 * The first paint uses defaults — overrides take effect on the second
 * render once the fetch resolves. We deliberately do NOT block render
 * on the fetch: the app should boot even if branding.json is unreachable.
 */
export function BrandingProvider({ children }: Props) {
  const [brand, setBrand] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    let cancelled = false;
    void loadBranding().then((b) => {
      if (cancelled) return;
      setBrand(b);
      applyBranding(b);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BrandingContext.Provider value={brand}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
