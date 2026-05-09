/**
 * Tests for the branding loader. Exercises:
 * - frozen defaults (no field is undefined)
 * - field-level sanitisation (invalid colour rejected, dangerous logoUrl
 *   rejected, oversized strings truncated)
 * - merge semantics (only declared overrides override; everything else
 *   stays at the default)
 * - fetch-failure fallback (network error / 404 / non-JSON / empty body)
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BRANDING } from "../src/branding/defaults.js";
import { loadBranding, mergeBranding } from "../src/branding/load.js";

describe("DEFAULT_BRANDING", () => {
  it("has every field set so a missing branding.json never leaves a hole", () => {
    expect(typeof DEFAULT_BRANDING.appName).toBe("string");
    expect(DEFAULT_BRANDING.appName.length).toBeGreaterThan(0);
    expect(typeof DEFAULT_BRANDING.tagline).toBe("string");
    expect(typeof DEFAULT_BRANDING.logoUrl).toBe("string");
    expect(DEFAULT_BRANDING.brandColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_BRANDING.brandColorDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(typeof DEFAULT_BRANDING.supportEmail).toBe("string");
    expect(typeof DEFAULT_BRANDING.footerText).toBe("string");
  });

  it("is immutable", () => {
    expect(Object.isFrozen(DEFAULT_BRANDING)).toBe(true);
  });
});

describe("mergeBranding", () => {
  it("returns the defaults when given an empty override", () => {
    expect(mergeBranding({})).toEqual(DEFAULT_BRANDING);
  });

  it("applies only the declared keys", () => {
    const merged = mergeBranding({ appName: "Acme Vault" });
    expect(merged.appName).toBe("Acme Vault");
    expect(merged.brandColor).toBe(DEFAULT_BRANDING.brandColor);
    expect(merged.tagline).toBe(DEFAULT_BRANDING.tagline);
  });

  it("does not mutate the frozen defaults", () => {
    mergeBranding({ appName: "Other" });
    expect(DEFAULT_BRANDING.appName).toBe("Passman");
  });
});

describe("loadBranding (sanitisation)", () => {
  function fetchReturning(body: unknown): typeof fetch {
    return (async () =>
      ({
        ok: true,
        async json() {
          return body;
        },
      }) as unknown as Response) as typeof fetch;
  }

  it("accepts a well-formed override and merges it over defaults", async () => {
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({
        appName: "Acme",
        brandColor: "#0a66c2",
        brandColorDark: "#084d92",
        tagline: "Built for ops.",
      }),
    );
    expect(brand.appName).toBe("Acme");
    expect(brand.brandColor).toBe("#0a66c2");
    expect(brand.brandColorDark).toBe("#084d92");
    expect(brand.tagline).toBe("Built for ops.");
    // Untouched keys stay at the default.
    expect(brand.logoUrl).toBe(DEFAULT_BRANDING.logoUrl);
  });

  it("rejects a non-hex brand colour and falls back to the default", async () => {
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({ brandColor: "javascript:alert(1)" }),
    );
    expect(brand.brandColor).toBe(DEFAULT_BRANDING.brandColor);
  });

  it("rejects malformed hex (too few / too many digits)", async () => {
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({ brandColor: "#GGG" }),
    );
    expect(brand.brandColor).toBe(DEFAULT_BRANDING.brandColor);
  });

  it("accepts same-origin paths for logoUrl", async () => {
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({ logoUrl: "/branding/logo.svg" }),
    );
    expect(brand.logoUrl).toBe("/branding/logo.svg");
  });

  it("accepts https:// and data: URLs for logoUrl", async () => {
    expect(
      (
        await loadBranding(
          "/branding.json",
          fetchReturning({ logoUrl: "https://cdn.example.com/logo.svg" }),
        )
      ).logoUrl,
    ).toBe("https://cdn.example.com/logo.svg");
    expect(
      (
        await loadBranding(
          "/branding.json",
          fetchReturning({ logoUrl: "data:image/svg+xml;base64,PHN2ZyAvPg==" }),
        )
      ).logoUrl,
    ).toBe("data:image/svg+xml;base64,PHN2ZyAvPg==");
  });

  it("rejects javascript: and other non-safe protocols for logoUrl", async () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://logo.example/img.png",
    ]) {
      const brand = await loadBranding(
        "/branding.json",
        fetchReturning({ logoUrl: bad }),
      );
      expect(brand.logoUrl).toBe("");
    }
  });

  it("truncates oversized strings to a sane cap", async () => {
    const longName = "A".repeat(500);
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({ appName: longName }),
    );
    // 64-char cap per the loader.
    expect(brand.appName.length).toBe(64);
  });

  it("ignores unknown keys", async () => {
    const brand = await loadBranding(
      "/branding.json",
      fetchReturning({ surpriseField: "nope", appName: "Acme" }),
    );
    expect((brand as unknown as { surpriseField?: string }).surpriseField).toBeUndefined();
    expect(brand.appName).toBe("Acme");
  });
});

describe("loadBranding (fetch failure modes)", () => {
  it("falls back to defaults on a network error", async () => {
    const brand = await loadBranding(
      "/branding.json",
      (async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch,
    );
    expect(brand).toEqual(DEFAULT_BRANDING);
  });

  it("falls back to defaults on a non-2xx response", async () => {
    const brand = await loadBranding(
      "/branding.json",
      (async () =>
        ({
          ok: false,
          async json() {
            return {};
          },
        }) as unknown as Response) as typeof fetch,
    );
    expect(brand).toEqual(DEFAULT_BRANDING);
  });

  it("falls back to defaults on a non-JSON body", async () => {
    const brand = await loadBranding(
      "/branding.json",
      (async () =>
        ({
          ok: true,
          async json() {
            throw new SyntaxError("not json");
          },
        }) as unknown as Response) as typeof fetch,
    );
    expect(brand).toEqual(DEFAULT_BRANDING);
  });

  it("returns defaults for an empty JSON body ({})", async () => {
    const brand = await loadBranding(
      "/branding.json",
      (async () =>
        ({
          ok: true,
          async json() {
            return {};
          },
        }) as unknown as Response) as typeof fetch,
    );
    expect(brand).toEqual(DEFAULT_BRANDING);
  });
});
