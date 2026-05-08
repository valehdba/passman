import { describe, expect, it } from "vitest";

import {
  constantTimeEqual,
  fromBase64,
  randomBytes,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../src/encoding.js";

describe("encoding", () => {
  it("round-trips utf-8 strings including non-ASCII", () => {
    const cases = ["hello", "", "🔐 пароль 密码", "a".repeat(10_000)];
    for (const c of cases) {
      expect(utf8Decode(utf8Encode(c))).toBe(c);
    }
  });

  it("round-trips base64", () => {
    for (let i = 0; i < 10; i++) {
      const bytes = randomBytes(32 + i);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it("randomBytes produces correct length and is non-deterministic", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a).not.toEqual(b);
  });

  it("randomBytes rejects invalid lengths", () => {
    expect(() => randomBytes(0)).toThrow();
    expect(() => randomBytes(-1)).toThrow();
    expect(() => randomBytes(1.5)).toThrow();
  });

  it("constantTimeEqual returns true only for identical content", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    const d = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
    expect(constantTimeEqual(a, d)).toBe(false);
  });
});
