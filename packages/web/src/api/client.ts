/**
 * Thin HTTP client for the Passman API.
 *
 * All endpoints return JSON. On non-2xx responses we throw `ApiError` with
 * the server's `detail` message so callers can show it directly.
 */

export class ApiError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface RegisterBody {
  email: string;
  auth_key: string;
  encrypted_symmetric_key: string;
  kdf_salt: string;
  kdf_time_cost: number;
  kdf_memory_cost: number;
  kdf_parallelism: number;
}

export interface KdfLookup {
  kdf_salt: string;
  kdf_time_cost: number;
  kdf_memory_cost: number;
  kdf_parallelism: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_in: number;
  refresh_expires_in: number;
  encrypted_symmetric_key: string;
  /** Set only when the OTP step was completed with "Trust this device". */
  device_token?: string | null;
  device_token_expires_in?: number | null;
}

export interface TrustedDevice {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

/** `POST /sessions` returns this when the user has 2FA enabled — phase-1
 *  only. The client must follow up with `POST /sessions/otp` carrying the
 *  same `otp_token` plus a 6-digit code (or a recovery code). */
export interface OtpChallenge {
  requires_otp: true;
  otp_token: string;
  otp_expires_in: number;
}

export type LoginResponse = TokenPair | OtpChallenge;

export function isOtpChallenge(r: LoginResponse): r is OtpChallenge {
  return (r as OtpChallenge).requires_otp === true;
}

export interface TotpStatus {
  enabled: boolean;
  recovery_codes_remaining: number;
}

export interface TotpSetup {
  provisioning_uri: string;
  secret_base32: string;
}

export interface SshTicket {
  ticket: string;
  expires_in: number;
}

export interface DbConnectionBody {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslmode: "disable" | "prefer" | "require";
}

export interface DbCheck {
  ok: boolean;
  server_version: string | null;
  schema_state: "empty" | "current" | "outdated" | "unmanaged" | "unknown";
  error: string | null;
}

export interface DbStatus {
  source: "env" | "saved";
  current: {
    host: string;
    port: number | null;
    database: string;
    username: string;
    sslmode: string | null;
  };
}

export interface VaultItem {
  id: string;
  item_type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}

const API_BASE = "/api"; // proxied by Vite in dev, served same-origin in prod

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(resp.status, detail);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const api = {
  register: (body: RegisterBody) =>
    request<{ user_id: string; email: string }>("/accounts/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  kdfLookup: (email: string) =>
    request<KdfLookup>(`/accounts/kdf?email=${encodeURIComponent(email)}`),

  login: (email: string, authKey: string, deviceToken?: string | null) =>
    request<LoginResponse>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        email,
        auth_key: authKey,
        ...(deviceToken ? { device_token: deviceToken } : {}),
      }),
    }),

  loginOtp: (
    otpToken: string,
    code: string,
    trust?: { days: number } | null,
  ) =>
    request<TokenPair>("/sessions/otp", {
      method: "POST",
      body: JSON.stringify({
        otp_token: otpToken,
        code,
        ...(trust ? { trust_device: true, trust_days: trust.days } : {}),
      }),
    }),

  listTrustedDevices: (token: string) =>
    request<TrustedDevice[]>("/account/trusted-devices", {}, token),

  revokeTrustedDevice: (token: string, id: string) =>
    request<void>(`/account/trusted-devices/${id}`, { method: "DELETE" }, token),

  revokeAllTrustedDevices: (token: string) =>
    request<void>("/account/trusted-devices", { method: "DELETE" }, token),

  sshConfig: (token: string) =>
    request<{ enabled: boolean }>("/ssh/config", {}, token),

  sshTicket: (
    token: string,
    body: { host: string; port: number; username: string },
  ) =>
    request<SshTicket>(
      "/ssh/tickets",
      { method: "POST", body: JSON.stringify(body) },
      token,
    ),

  adminDbStatus: (token: string) =>
    request<DbStatus>("/admin/database", {}, token),

  adminDbTest: (token: string, body: DbConnectionBody) =>
    request<DbCheck>(
      "/admin/database/test",
      { method: "POST", body: JSON.stringify(body) },
      token,
    ),

  adminDbSwitch: (token: string, body: DbConnectionBody) =>
    request<DbStatus>(
      "/admin/database",
      { method: "PUT", body: JSON.stringify({ ...body, confirm: true }) },
      token,
    ),

  adminDbReset: (token: string) =>
    request<DbStatus>("/admin/database", { method: "DELETE" }, token),

  totpStatus: (token: string) =>
    request<TotpStatus>("/account/totp/status", {}, token),

  totpSetup: (token: string) =>
    request<TotpSetup>("/account/totp/setup", { method: "POST" }, token),

  totpConfirm: (token: string, code: string) =>
    request<{ recovery_codes: string[] }>(
      "/account/totp/confirm",
      { method: "POST", body: JSON.stringify({ code }) },
      token,
    ),

  totpDisable: (token: string, code: string) =>
    request<void>(
      "/account/totp/disable",
      { method: "POST", body: JSON.stringify({ code }) },
      token,
    ),

  logout: (token: string, refreshToken: string) =>
    request<void>("/sessions", {
      method: "DELETE",
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, token),

  listItems: (token: string) =>
    request<{ items: VaultItem[] }>("/vault/items", {}, token),

  createItem: (
    token: string,
    body: { item_type: string; encrypted_data: string },
  ) =>
    request<VaultItem>("/vault/items", {
      method: "POST",
      body: JSON.stringify(body),
    }, token),

  updateItem: (
    token: string,
    id: string,
    body: { item_type?: string; encrypted_data?: string },
  ) =>
    request<VaultItem>(`/vault/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, token),

  deleteItem: (token: string, id: string) =>
    request<void>(`/vault/items/${id}`, { method: "DELETE" }, token),
};
