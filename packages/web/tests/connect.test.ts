import { describe, expect, it } from "vitest";

import { buildConnectCommand } from "../src/connect/command.js";
import { buildJdbcUrl, supportsJdbc } from "../src/connect/jdbc.js";
import {
  buildTargetSubtitle,
  canBuildRdp,
  defaultPort,
  effectiveProtocol,
  engineCode,
  inferProtocolFromPort,
  protocolLabel,
} from "../src/connect/protocol.js";
import { buildRdpFile } from "../src/connect/rdp.js";
import { buildSshUrl } from "../src/connect/ssh.js";

import type { VaultLoginPlaintext } from "@passman/core";

const baseItem: VaultLoginPlaintext = {
  name: "test",
  username: "alice",
  password: "secret",
};

describe("protocol inference", () => {
  it("maps well-known ports to protocols", () => {
    expect(inferProtocolFromPort(22)).toBe("ssh");
    expect(inferProtocolFromPort(3389)).toBe("rdp");
    expect(inferProtocolFromPort(5432)).toBe("psql");
    expect(inferProtocolFromPort(3306)).toBe("mysql");
    expect(inferProtocolFromPort(1521)).toBe("oracle");
    expect(inferProtocolFromPort(1433)).toBe("mssql");
    expect(inferProtocolFromPort(6379)).toBe("redis");
    expect(inferProtocolFromPort(27017)).toBe("mongo");
    expect(inferProtocolFromPort(443)).toBe("https");
  });

  it("returns undefined for unknown ports", () => {
    expect(inferProtocolFromPort(12345)).toBeUndefined();
    expect(inferProtocolFromPort(undefined)).toBeUndefined();
  });

  it("prefers declared protocol over inference", () => {
    expect(effectiveProtocol({ ...baseItem, port: 5432, protocol: "ssh" })).toBe("ssh");
  });

  it("falls back to port inference when protocol absent", () => {
    expect(effectiveProtocol({ ...baseItem, port: 27017 })).toBe("mongo");
  });

  it("provides engine codes for the badge tile", () => {
    expect(engineCode("psql")).toBe("PG");
    expect(engineCode("oracle")).toBe("OR");
    expect(engineCode("ssh")).toBe("SSH");
    expect(engineCode(undefined)).toBe("—");
  });

  it("provides uppercase protocol labels for the pill", () => {
    expect(protocolLabel("psql")).toBe("PSQL");
    expect(protocolLabel("rdp")).toBe("RDP");
    expect(protocolLabel(undefined)).toBe("—");
  });

  it("provides default ports for known protocols", () => {
    expect(defaultPort("ssh")).toBe(22);
    expect(defaultPort("rdp")).toBe(3389);
    expect(defaultPort("oracle")).toBe(1521);
    expect(defaultPort(undefined)).toBeUndefined();
  });
});

describe("buildJdbcUrl", () => {
  it("builds Postgres URLs with database and port", () => {
    const url = buildJdbcUrl({
      ...baseItem,
      protocol: "psql",
      hostname: "db-prod-01",
      port: 5432,
      database: "app",
    });
    expect(url).toBe("jdbc:postgresql://db-prod-01:5432/app");
  });

  it("defaults Postgres database to 'postgres' when unset", () => {
    expect(
      buildJdbcUrl({ ...baseItem, protocol: "psql", hostname: "h", port: 5432 }),
    ).toBe("jdbc:postgresql://h:5432/postgres");
  });

  it("builds MySQL URLs", () => {
    expect(
      buildJdbcUrl({
        ...baseItem,
        protocol: "mysql",
        hostname: "h",
        port: 3306,
        database: "reports",
      }),
    ).toBe("jdbc:mysql://h:3306/reports");
  });

  it("builds MariaDB URLs (same shape as MySQL, different driver)", () => {
    expect(
      buildJdbcUrl({
        ...baseItem,
        protocol: "mariadb",
        hostname: "h",
        port: 3306,
      }),
    ).toBe("jdbc:mariadb://h:3306/");
  });

  it("builds Oracle SERVICE_NAME URLs (preferred form)", () => {
    expect(
      buildJdbcUrl({
        ...baseItem,
        protocol: "oracle",
        hostname: "erp-db-01",
        port: 1521,
        serviceName: "ERPSVC",
      }),
    ).toBe("jdbc:oracle:thin:@//erp-db-01:1521/ERPSVC");
  });

  it("falls back to Oracle SID-style URLs when no service name", () => {
    expect(
      buildJdbcUrl({
        ...baseItem,
        protocol: "oracle",
        hostname: "erp-db-01",
        port: 1521,
        database: "ORCL1",
      }),
    ).toBe("jdbc:oracle:thin:@erp-db-01:1521:ORCL1");
  });

  it("builds SQL Server URLs with semicolon-separated databaseName", () => {
    expect(
      buildJdbcUrl({
        ...baseItem,
        protocol: "mssql",
        hostname: "sqlbox",
        port: 1433,
        database: "sales",
      }),
    ).toBe("jdbc:sqlserver://sqlbox:1433;databaseName=sales");
  });

  it("returns null for protocols without standard JDBC drivers", () => {
    expect(buildJdbcUrl({ ...baseItem, protocol: "ssh", hostname: "h" })).toBeNull();
    expect(buildJdbcUrl({ ...baseItem, protocol: "rdp", hostname: "h" })).toBeNull();
    expect(buildJdbcUrl({ ...baseItem, protocol: "redis", hostname: "h" })).toBeNull();
  });

  it("returns null when host is missing", () => {
    expect(buildJdbcUrl({ ...baseItem, protocol: "psql" })).toBeNull();
  });

  it("supportsJdbc reports correctly", () => {
    expect(supportsJdbc("psql")).toBe(true);
    expect(supportsJdbc("oracle")).toBe(true);
    expect(supportsJdbc("redis")).toBe(false);
    expect(supportsJdbc("ssh")).toBe(false);
    expect(supportsJdbc(undefined)).toBe(false);
  });
});

describe("buildConnectCommand", () => {
  it("builds psql commands", () => {
    expect(
      buildConnectCommand({
        ...baseItem,
        protocol: "psql",
        hostname: "db-prod-01",
        port: 5432,
        username: "postgres",
        database: "app",
      }),
    ).toBe("psql 'postgres://postgres@db-prod-01:5432/app'");
  });

  it("builds ssh commands and omits port 22", () => {
    expect(
      buildConnectCommand({
        ...baseItem,
        protocol: "ssh",
        hostname: "host",
        port: 22,
        username: "alice",
      }),
    ).toBe("ssh alice@host");
  });

  it("includes -p for non-default ssh ports", () => {
    expect(
      buildConnectCommand({
        ...baseItem,
        protocol: "ssh",
        hostname: "host",
        port: 2222,
        username: "alice",
      }),
    ).toBe("ssh alice@host -p 2222");
  });

  it("builds mysql commands without inlining the password", () => {
    const cmd = buildConnectCommand({
      ...baseItem,
      protocol: "mysql",
      hostname: "h",
      port: 3306,
      username: "u",
      database: "d",
    });
    expect(cmd).toBe("mysql -h h -u u -p d");
    expect(cmd).not.toContain("secret");
  });

  it("builds Oracle sqlplus commands using service name", () => {
    expect(
      buildConnectCommand({
        ...baseItem,
        protocol: "oracle",
        hostname: "erp-db-01",
        port: 1521,
        username: "sys",
        serviceName: "ERPSVC",
      }),
    ).toBe("sqlplus 'sys/****@//erp-db-01:1521/ERPSVC'");
  });

  it("builds redis-cli with $PASSWORD placeholder, not the literal", () => {
    const cmd = buildConnectCommand({
      ...baseItem,
      username: "default",
      protocol: "redis",
      hostname: "cache",
      port: 6379,
    });
    expect(cmd).toBe('redis-cli -h cache -a "$PASSWORD"');
    expect(cmd).not.toContain("secret");
  });

  it("builds redis-cli with --user for non-default Redis ACL accounts", () => {
    const cmd = buildConnectCommand({
      ...baseItem,
      username: "reporter",
      protocol: "redis",
      hostname: "cache",
      port: 6379,
    });
    expect(cmd).toBe('redis-cli -h cache --user reporter -a "$PASSWORD"');
  });

  it("returns null for RDP (GUI client, no canonical command)", () => {
    expect(
      buildConnectCommand({ ...baseItem, protocol: "rdp", hostname: "host" }),
    ).toBeNull();
  });

  it("returns null when host is missing", () => {
    expect(buildConnectCommand({ ...baseItem, protocol: "ssh" })).toBeNull();
  });
});

describe("buildSshUrl", () => {
  it("encodes the username and host into ssh:// form", () => {
    expect(
      buildSshUrl({ ...baseItem, hostname: "host", port: 22, username: "alice" }),
    ).toBe("ssh://alice@host");
  });

  it("includes non-default ports", () => {
    expect(
      buildSshUrl({ ...baseItem, hostname: "host", port: 2222, username: "alice" }),
    ).toBe("ssh://alice@host:2222");
  });

  it("URL-encodes usernames with special chars", () => {
    expect(
      buildSshUrl({
        ...baseItem,
        hostname: "host",
        username: "alice@corp",
      }),
    ).toBe("ssh://alice%40corp@host");
  });

  it("does NOT include the password", () => {
    const url = buildSshUrl({
      ...baseItem,
      hostname: "host",
      username: "alice",
      password: "shouldnotleak",
    });
    expect(url).not.toContain("shouldnotleak");
  });

  it("falls back to ip when hostname is absent", () => {
    expect(buildSshUrl({ ...baseItem, ip: "10.0.0.1", username: "alice" })).toBe(
      "ssh://alice@10.0.0.1",
    );
  });

  it("returns null without any host", () => {
    expect(buildSshUrl({ ...baseItem })).toBeNull();
  });
});

describe("buildRdpFile", () => {
  it("emits a valid .rdp file with full address and username", () => {
    const file = buildRdpFile({
      ...baseItem,
      protocol: "rdp",
      hostname: "erp-db-01",
      port: 3389,
      username: "admin",
    });
    expect(file).not.toBeNull();
    expect(file).toContain("full address:s:erp-db-01:3389");
    expect(file).toContain("username:s:admin");
    // CRLF line endings — required by Windows RDP clients.
    expect(file).toContain("\r\n");
  });

  it("encodes Windows AD domain into the username field", () => {
    const file = buildRdpFile({
      ...baseItem,
      protocol: "rdp",
      hostname: "host",
      username: "admin",
      domain: "EXAMPLE",
    });
    expect(file).toContain("username:s:EXAMPLE\\admin");
  });

  it("defaults to port 3389 when unset", () => {
    const file = buildRdpFile({ ...baseItem, protocol: "rdp", hostname: "host" });
    expect(file).toContain("full address:s:host:3389");
  });

  it("never embeds the password (RDP requires DPAPI/keychain)", () => {
    const file = buildRdpFile({
      ...baseItem,
      password: "supersecretpassword",
      protocol: "rdp",
      hostname: "host",
    });
    expect(file).not.toContain("supersecretpassword");
  });

  it("returns null when there is no host", () => {
    expect(buildRdpFile({ ...baseItem, protocol: "rdp" })).toBeNull();
  });
});

describe("buildTargetSubtitle (Connect dialog header subtitle)", () => {
  it("renders host:port + user without duplicating the host", () => {
    expect(
      buildTargetSubtitle({
        ...baseItem,
        hostname: "db-prod-01",
        ip: "10.0.0.42",
        port: 5432,
        username: "postgres",
      }),
    ).toBe("db-prod-01:5432 · 10.0.0.42 · postgres");
  });

  it("collapses ip when it equals the hostname", () => {
    expect(
      buildTargetSubtitle({
        ...baseItem,
        hostname: "10.0.0.42",
        ip: "10.0.0.42",
        port: 5432,
      }),
    ).toBe("10.0.0.42:5432 · alice");
  });

  it("falls back to ip when hostname is missing", () => {
    expect(
      buildTargetSubtitle({
        ...baseItem,
        ip: "10.0.0.42",
        port: 5432,
      }),
    ).toBe("10.0.0.42:5432 · alice");
  });

  it("encodes Windows AD domain into the user segment for RDP entries", () => {
    expect(
      buildTargetSubtitle({
        ...baseItem,
        protocol: "rdp",
        hostname: "host",
        port: 3389,
        username: "admin",
        domain: "EXAMPLE",
      }),
    ).toBe("host:3389 · EXAMPLE\\admin");
  });

  it("omits port when unset", () => {
    expect(
      buildTargetSubtitle({ ...baseItem, hostname: "host", username: "alice" }),
    ).toBe("host · alice");
  });

  it("returns the empty string when no host or user", () => {
    expect(buildTargetSubtitle({ name: "x", username: "", password: "" })).toBe("");
  });
});

describe("canBuildRdp (gates the Open RDP session option)", () => {
  it("is true for an RDP credential with a host", () => {
    expect(
      canBuildRdp({
        ...baseItem,
        protocol: "rdp",
        hostname: "erp-db-01",
        port: 3389,
      }),
    ).toBe(true);
  });

  it("is true when protocol is inferred from port 3389", () => {
    // No explicit protocol — port 3389 should infer RDP.
    expect(
      canBuildRdp({ ...baseItem, hostname: "host", port: 3389 }),
    ).toBe(true);
  });

  it("is FALSE for a Postgres credential — its port isn't an RDP port", () => {
    // This is the regression. Without this gate, canBuildRdp would yield
    // an .rdp file pointing at port 5432, which doesn't run RDP.
    expect(
      canBuildRdp({
        ...baseItem,
        protocol: "psql",
        hostname: "db-prod-01",
        port: 5432,
      }),
    ).toBe(false);
  });

  it("is false for any non-RDP protocol with a host", () => {
    expect(canBuildRdp({ ...baseItem, protocol: "ssh", hostname: "h" })).toBe(false);
    expect(canBuildRdp({ ...baseItem, protocol: "redis", hostname: "h" })).toBe(false);
    expect(canBuildRdp({ ...baseItem, protocol: "mongo", hostname: "h" })).toBe(false);
  });

  it("is false for an RDP credential without a host", () => {
    expect(canBuildRdp({ ...baseItem, protocol: "rdp", port: 3389 })).toBe(false);
  });
});
