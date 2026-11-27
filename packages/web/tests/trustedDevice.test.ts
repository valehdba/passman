import { beforeEach, describe, expect, it } from "vitest";

import {
  TRUST_STORAGE_KEY,
  clearAllTrustTokens,
  clearTrustToken,
  getTrustToken,
  setTrustToken,
} from "../src/stores/trustedDevice.js";

// vitest runs in node: provide a minimal localStorage.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe("trustedDevice store", () => {
  it("returns the token until it expires, then drops it", () => {
    setTrustToken("A@Example.com", "tok", 100, 1_000);
    expect(getTrustToken("a@example.com", 50_000)).toBe("tok"); // email is case-insensitive
    expect(getTrustToken("a@example.com", 101_000)).toBeNull(); // expired at 1_000 + 100_000
    expect(getTrustToken("a@example.com", 1_000)).toBeNull(); // and was removed
  });

  it("is scoped per email and clearable", () => {
    setTrustToken("a@x.com", "ta", 100);
    setTrustToken("b@x.com", "tb", 100);
    clearTrustToken("a@x.com");
    expect(getTrustToken("a@x.com")).toBeNull();
    expect(getTrustToken("b@x.com")).toBe("tb");
    clearAllTrustTokens();
    expect(getTrustToken("b@x.com")).toBeNull();
  });

  it("ignores corrupt storage", () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
      TRUST_STORAGE_KEY,
      "{not json",
    );
    expect(getTrustToken("a@x.com")).toBeNull();
    localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify({ "a@x.com": { token: 5 } }));
    expect(getTrustToken("a@x.com")).toBeNull();
  });
});
