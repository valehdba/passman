import { describe, expect, it } from "vitest";

import {
  buildAlphabet,
  DEFAULT_OPTIONS,
  estimateEntropyBits,
  GeneratorError,
  generatePassword,
  strengthLabel,
  type PasswordOptions,
} from "../src/passwords/index.js";

describe("password generator", () => {
  function opts(overrides: Partial<PasswordOptions> = {}): PasswordOptions {
    return { ...DEFAULT_OPTIONS, ...overrides };
  }

  it("returns a string of the requested length", () => {
    for (const length of [1, 8, 20, 64]) {
      expect(generatePassword(opts({ length }))).toHaveLength(length);
    }
  });

  it("uses only characters from the requested alphabet", () => {
    const alphabet = buildAlphabet(opts({ symbols: false }));
    const pw = generatePassword(opts({ length: 50, symbols: false }));
    for (const c of pw) {
      expect(alphabet.includes(c)).toBe(true);
    }
  });

  it("forces at least one of each requested class when length permits", () => {
    // With every class on and length 8, the result must contain at
    // least one lower, one upper, one digit, and one symbol.
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(opts({ length: 8 }));
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/\d/.test(pw)).toBe(true);
      expect(/[!@#$%^&*()\-_=+[\]{};:,.<>/?]/.test(pw)).toBe(true);
    }
  });

  it("excludes ambiguous characters when avoidAmbiguous is on", () => {
    const pw = generatePassword(opts({ length: 200, avoidAmbiguous: true }));
    expect(pw).not.toMatch(/[0O1lI|`]/);
  });

  it("rejects zero-length and empty-alphabet configs", () => {
    expect(() => generatePassword(opts({ length: 0 }))).toThrow(GeneratorError);
    expect(() =>
      generatePassword(
        opts({
          lowercase: false,
          uppercase: false,
          digits: false,
          symbols: false,
        }),
      ),
    ).toThrow(GeneratorError);
  });

  it("yields different output across consecutive calls", () => {
    // CSPRNG; collision in 50 chars × 70-char alphabet is astronomically unlikely.
    const a = generatePassword(opts({ length: 50 }));
    const b = generatePassword(opts({ length: 50 }));
    expect(a).not.toBe(b);
  });

  it("estimates entropy as length × log2(alphabet size)", () => {
    const o = opts({ length: 20 });
    const alphabet = buildAlphabet(o).length;
    expect(estimateEntropyBits(o)).toBeCloseTo(20 * Math.log2(alphabet), 6);
    expect(estimateEntropyBits(opts({ length: 0 }))).toBe(0);
  });

  it("classifies strength by entropy bits", () => {
    expect(strengthLabel(20)).toBe("weak");
    expect(strengthLabel(50)).toBe("fair");
    expect(strengthLabel(80)).toBe("strong");
    expect(strengthLabel(120)).toBe("excellent");
  });
});
