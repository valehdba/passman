import { describe, expect, it } from "vitest";

import { parseBitwardenCsv } from "../src/import/bitwarden.js";
import { parseCsv } from "../src/import/csv.js";

describe("CSV parser", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas + escaped quotes", () => {
    const input = '"name","notes"\n"Acme","He said ""hi"", then , left"\n';
    expect(parseCsv(input)).toEqual([
      ["name", "notes"],
      ["Acme", 'He said "hi", then , left'],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves embedded newlines inside quoted fields", () => {
    expect(parseCsv('"a","line1\nline2"\n')).toEqual([["a", "line1\nline2"]]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("Bitwarden CSV import", () => {
  const HEADER =
    "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n";

  it("parses login rows into VaultLoginPlaintext shape", () => {
    const csv = HEADER +
      ',,login,GitHub,,,,https://github.com,alice,hunter2,otpauth://totp/foo\n';
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.plaintext).toEqual({
      name: "GitHub",
      username: "alice",
      password: "hunter2",
      url: "https://github.com",
      totp: "otpauth://totp/foo",
    });
    expect(result.skipped).toEqual([]);
  });

  it("skips non-login items with a reason", () => {
    const csv = HEADER + ',,note,My note,some text,,,,,\n';
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/non-login/);
  });

  it("skips rows with empty password", () => {
    const csv = HEADER + ',,login,Empty pw,,,,,alice,,\n';
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/empty password/);
  });

  it("skips rows with empty name", () => {
    const csv = HEADER + ',,login,,,,,,alice,hunter2,\n';
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/Missing name/);
  });

  it("rejects files without the required columns", () => {
    const csv = "wrong,header\nfoo,bar\n";
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/Missing required columns/);
  });

  it("handles header-case differences (Bitwarden v2024 capitalisation)", () => {
    const csv =
      "Folder,Favorite,Type,Name,Notes,Fields,Reprompt,Login_URI,Login_Username,Login_Password,Login_TOTP\n" +
      ',,login,GitHub,,,,https://github.com,alice,hunter2,\n';
    const result = parseBitwardenCsv(csv);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.plaintext.name).toBe("GitHub");
  });

  it("returns empty for empty input", () => {
    expect(parseBitwardenCsv("")).toEqual({ candidates: [], skipped: [] });
  });
});
