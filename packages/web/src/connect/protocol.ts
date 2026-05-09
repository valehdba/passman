import type { Protocol, VaultLoginPlaintext } from "@passman/core";

/**
 * Map a port number to its most likely protocol. Used as a fallback when a
 * credential predates the protocol field, or for sane defaults in the Add
 * Credential form.
 */
export function inferProtocolFromPort(port: number | undefined): Protocol | undefined {
  switch (port) {
    case 22: return "ssh";
    case 3389: return "rdp";
    case 5432: return "psql";
    case 3306: return "mysql";
    case 1521: return "oracle";
    case 1433: return "mssql";
    case 6379: return "redis";
    case 27017: return "mongo";
    case 443: return "https";
    default: return undefined;
  }
}

/** Resolve the effective protocol of an item — declared, else inferred from port. */
export function effectiveProtocol(item: VaultLoginPlaintext): Protocol | undefined {
  if (item.protocol) return item.protocol;
  return inferProtocolFromPort(item.port);
}

/** A short engine code shown in the engine-tile (PG, MY, OR, RD, MG, SSH, RDP). */
export function engineCode(protocol: Protocol | undefined): string {
  switch (protocol) {
    case "psql": return "PG";
    case "mysql": return "MY";
    case "mariadb": return "MR";
    case "oracle": return "OR";
    case "mssql": return "MS";
    case "redis": return "RD";
    case "mongo": return "MG";
    case "ssh": return "SSH";
    case "rdp": return "RDP";
    case "https": return "WEB";
    default: return "—";
  }
}

/** Display label for the protocol pill (uppercase, mono). */
export function protocolLabel(protocol: Protocol | undefined): string {
  switch (protocol) {
    case "psql": return "PSQL";
    case "mysql": return "MYSQL";
    case "mariadb": return "MARIADB";
    case "oracle": return "ORACLE";
    case "mssql": return "MSSQL";
    case "redis": return "REDIS";
    case "mongo": return "MONGO";
    case "ssh": return "SSH";
    case "rdp": return "RDP";
    case "https": return "HTTPS";
    case "other": return "OTHER";
    default: return "—";
  }
}

/** Default port for a given protocol — used when the user hasn't entered one. */
export function defaultPort(protocol: Protocol | undefined): number | undefined {
  switch (protocol) {
    case "ssh": return 22;
    case "rdp": return 3389;
    case "psql": return 5432;
    case "mysql": return 3306;
    case "mariadb": return 3306;
    case "oracle": return 1521;
    case "mssql": return 1433;
    case "redis": return 6379;
    case "mongo": return 27017;
    case "https": return 443;
    default: return undefined;
  }
}
