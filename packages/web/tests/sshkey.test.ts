import { describe, expect, it } from "vitest";

import { buildSshKeyCommand, looksLikePem } from "../src/connect/sshkey.js";

describe("looksLikePem", () => {
  it("accepts an OpenSSH-format private key", () => {
    expect(
      looksLikePem(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64body\n-----END OPENSSH PRIVATE KEY-----",
      ),
    ).toBe(true);
  });

  it("accepts an RSA-format private key", () => {
    expect(
      looksLikePem(
        "-----BEGIN RSA PRIVATE KEY-----\nbase64body\n-----END RSA PRIVATE KEY-----",
      ),
    ).toBe(true);
  });

  it("accepts a PKCS#8 PRIVATE KEY block", () => {
    expect(
      looksLikePem(
        "-----BEGIN PRIVATE KEY-----\nbase64body\n-----END PRIVATE KEY-----",
      ),
    ).toBe(true);
  });

  it("rejects non-private-key PEMs (cert, public key)", () => {
    expect(
      looksLikePem(
        "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      ),
    ).toBe(false);
    expect(
      looksLikePem(
        "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
      ),
    ).toBe(false);
  });

  it("rejects empty / random text", () => {
    expect(looksLikePem("")).toBe(false);
    expect(looksLikePem("hello world")).toBe(false);
    expect(looksLikePem("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(false);
  });
});

describe("buildSshKeyCommand", () => {
  it("emits an ssh -i invocation pointing at a sanitised filename", () => {
    expect(
      buildSshKeyCommand({
        name: "prod pg primary!",
        username: "postgres",
        password: "x",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----",
        hostname: "db-prod-01",
        port: 22,
      }),
    ).toBe("ssh -i ~/.ssh/passman/prod-pg-primary-.pem postgres@db-prod-01");
  });

  it("includes -p for non-default ports", () => {
    expect(
      buildSshKeyCommand({
        name: "host",
        username: "alice",
        password: "x",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----",
        hostname: "host",
        port: 2222,
      }),
    ).toBe("ssh -i ~/.ssh/passman/host.pem alice@host -p 2222");
  });

  it("returns null without a host", () => {
    expect(
      buildSshKeyCommand({
        name: "x",
        username: "u",
        password: "p",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----",
      }),
    ).toBeNull();
  });

  it("returns null without a key", () => {
    expect(
      buildSshKeyCommand({ name: "x", username: "u", password: "p", hostname: "h" }),
    ).toBeNull();
  });
});
