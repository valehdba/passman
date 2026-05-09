import type { VaultLoginPlaintext } from "@passman/core";

import { effectiveProtocol } from "./protocol.js";

/**
 * Build a ready-to-paste shell command for connecting to the credential's
 * target. The password is NEVER inlined — when relevant, the caller should
 * also push the password onto the clipboard via the clipboard module.
 *
 * Returns null when there's no canonical command (RDP — that's a GUI thing).
 */
export function buildConnectCommand(item: VaultLoginPlaintext): string | null {
  const protocol = effectiveProtocol(item);
  if (!protocol) return null;

  const host = item.hostname || item.ip;
  if (!host) return null;
  const user = item.username || "";
  const port = item.port;

  switch (protocol) {
    case "ssh": {
      const userAt = user ? `${user}@` : "";
      return port && port !== 22
        ? `ssh ${userAt}${host} -p ${port}`
        : `ssh ${userAt}${host}`;
    }
    case "psql": {
      const db = item.database || "postgres";
      const userAt = user ? `${user}@` : "";
      const portPart = port ? `:${port}` : "";
      return `psql 'postgres://${userAt}${host}${portPart}/${db}'`;
    }
    case "mysql": {
      const userArg = user ? ` -u ${user}` : "";
      const portArg = port && port !== 3306 ? ` -P ${port}` : "";
      const dbArg = item.database ? ` ${item.database}` : "";
      return `mysql -h ${host}${userArg}${portArg} -p${dbArg}`.trim();
    }
    case "mariadb": {
      const userArg = user ? ` -u ${user}` : "";
      const portArg = port && port !== 3306 ? ` -P ${port}` : "";
      const dbArg = item.database ? ` ${item.database}` : "";
      return `mariadb -h ${host}${userArg}${portArg} -p${dbArg}`.trim();
    }
    case "oracle": {
      const service = item.serviceName || item.database || "";
      const portPart = port ? `:${port}` : "";
      return service
        ? `sqlplus '${user || "system"}/****@//${host}${portPart}/${service}'`
        : `sqlplus '${user || "system"}/****@${host}${portPart}'`;
    }
    case "mssql": {
      const userArg = user ? ` -U ${user}` : "";
      const portArg = port && port !== 1433 ? `,${port}` : "";
      const dbArg = item.database ? ` -d ${item.database}` : "";
      return `sqlcmd -S ${host}${portArg}${userArg} -P "$PASSWORD"${dbArg}`;
    }
    case "redis": {
      const portArg = port && port !== 6379 ? ` -p ${port}` : "";
      const userArg = user && user !== "default" ? ` --user ${user}` : "";
      return `redis-cli -h ${host}${portArg}${userArg} -a "$PASSWORD"`;
    }
    case "mongo": {
      const userPart = user ? `${user}:****@` : "";
      const portPart = port ? `:${port}` : "";
      const db = item.database ? `/${item.database}` : "";
      return `mongosh 'mongodb://${userPart}${host}${portPart}${db}'`;
    }
    case "rdp":
    case "https":
    case "other":
      return null;
  }

  const _exhaustive: never = protocol;
  return _exhaustive;
}
