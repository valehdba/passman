import { describe, expect, it } from "vitest";

import { isOtpChallenge } from "../src/api/client.js";
import { formatSecretForDisplay } from "../src/twofactor/qrcode.js";

describe("isOtpChallenge", () => {
  it("returns true for the OtpChallenge shape", () => {
    expect(
      isOtpChallenge({
        requires_otp: true,
        otp_token: "x",
        otp_expires_in: 300,
      }),
    ).toBe(true);
  });

  it("returns false for a TokenPair", () => {
    expect(
      isOtpChallenge({
        access_token: "a",
        refresh_token: "r",
        access_expires_in: 900,
        refresh_expires_in: 86400,
        encrypted_symmetric_key: "v1:iv:ct",
      } as unknown as ReturnType<typeof Object>),
    ).toBe(false);
  });
});

describe("formatSecretForDisplay", () => {
  it("groups the base32 secret into readable 4-char blocks", () => {
    expect(formatSecretForDisplay("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("uppercases and strips embedded whitespace", () => {
    expect(formatSecretForDisplay("  jbswy3dp ehpk3pxp ")).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
  });

  it("returns the input unchanged for very short strings (no fallback split)", () => {
    expect(formatSecretForDisplay("ABC")).toBe("ABC");
  });
});
