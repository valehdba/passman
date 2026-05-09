import type { Protocol, VaultLoginPlaintext } from "@passman/core";

import { effectiveProtocol } from "./protocol.js";

/**
 * Build a JDBC URL for a credential. Returns `null` if the protocol has no
 * standard JDBC driver (SSH, RDP, Redis — the last has no native JDBC).
 *
 * The URL never embeds the password. Most JDBC tools (DBeaver, DataGrip,
 * DBVisualizer) want the password in a separate field, and embedding it in
 * the URL leaks it into driver connection logs and (on some platforms) into
 * `ps` output.
 */
export function buildJdbcUrl(item: VaultLoginPlaintext): string | null {
  const protocol = effectiveProtocol(item);
  if (!protocol) return null;

  const host = item.hostname || item.ip;
  if (!host) return null;
  const port = item.port;

  switch (protocol) {
    case "psql": {
      const db = item.database || "postgres";
      return port
        ? `jdbc:postgresql://${host}:${port}/${db}`
        : `jdbc:postgresql://${host}/${db}`;
    }
    case "mysql": {
      const db = item.database || "";
      return port
        ? `jdbc:mysql://${host}:${port}/${db}`
        : `jdbc:mysql://${host}/${db}`;
    }
    case "mariadb": {
      const db = item.database || "";
      return port
        ? `jdbc:mariadb://${host}:${port}/${db}`
        : `jdbc:mariadb://${host}/${db}`;
    }
    case "oracle": {
      // SERVICE_NAME form is preferred; fall back to SID-style host:port:sid
      // by treating the database field as the SID if no serviceName is set.
      const service = item.serviceName;
      if (service) {
        return port
          ? `jdbc:oracle:thin:@//${host}:${port}/${service}`
          : `jdbc:oracle:thin:@//${host}/${service}`;
      }
      const sid = item.database || "ORCL";
      return port
        ? `jdbc:oracle:thin:@${host}:${port}:${sid}`
        : `jdbc:oracle:thin:@${host}:1521:${sid}`;
    }
    case "mssql": {
      const db = item.database;
      const base = port
        ? `jdbc:sqlserver://${host}:${port}`
        : `jdbc:sqlserver://${host}`;
      return db ? `${base};databaseName=${db}` : base;
    }
    case "mongo": {
      // Non-standard JDBC driver; included for completeness.
      const db = item.database || "";
      return port
        ? `jdbc:mongodb://${host}:${port}/${db}`
        : `jdbc:mongodb://${host}/${db}`;
    }
    case "redis":
    case "ssh":
    case "rdp":
    case "https":
    case "other":
      return null;
  }

  // Exhaustiveness: TS will warn if a Protocol case is unhandled.
  const _exhaustive: never = protocol;
  return _exhaustive;
}

/** Whether this protocol has a meaningful JDBC URL. */
export function supportsJdbc(protocol: Protocol | undefined): boolean {
  if (!protocol) return false;
  return ["psql", "mysql", "mariadb", "oracle", "mssql", "mongo"].includes(protocol);
}
