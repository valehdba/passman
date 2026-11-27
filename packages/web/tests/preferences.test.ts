import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, sanitizePreferences } from "../src/stores/preferences.js";

describe("sanitizePreferences", () => {
  it("returns defaults for missing or non-object input", () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid values", () => {
    expect(
      sanitizePreferences({ autoLockMinutes: 5, clipboardClearSeconds: 0, defaultProtocol: "psql", defaultStorage: "local" }),
    ).toEqual({
      autoLockMinutes: 5,
      clipboardClearSeconds: 0,
      defaultProtocol: "psql",
      defaultStorage: "local",
    });
  });

  it("clamps out-of-range numbers and rejects non-numbers", () => {
    const p = sanitizePreferences({ autoLockMinutes: 99999, clipboardClearSeconds: -5 });
    expect(p.autoLockMinutes).toBe(24 * 60);
    expect(p.clipboardClearSeconds).toBe(0);
    expect(sanitizePreferences({ autoLockMinutes: "5" }).autoLockMinutes).toBe(
      DEFAULT_PREFERENCES.autoLockMinutes,
    );
    expect(sanitizePreferences({ autoLockMinutes: NaN }).autoLockMinutes).toBe(
      DEFAULT_PREFERENCES.autoLockMinutes,
    );
  });

  it("accepts only server or local for defaultStorage", () => {
    expect(sanitizePreferences({ defaultStorage: "local" }).defaultStorage).toBe("local");
    expect(sanitizePreferences({ defaultStorage: "cloud" }).defaultStorage).toBe("server");
    expect(sanitizePreferences({}).defaultStorage).toBe("server");
  });

  it("rejects unknown protocols", () => {
    expect(sanitizePreferences({ defaultProtocol: "telnet" }).defaultProtocol).toBe("");
    expect(sanitizePreferences({ defaultProtocol: 5 }).defaultProtocol).toBe("");
  });
});
