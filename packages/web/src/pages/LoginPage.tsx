import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  deriveLoginAuthKey,
  unlock,
  type KdfParams,
  type VaultSession,
} from "@passman/core";

import { ApiError, api, isOtpChallenge, type TokenPair } from "../api/client.js";
import { useBranding } from "../branding/index.js";
import { useSession } from "../stores/session.js";
import { BrandHeader } from "./vault/BrandHeader.js";

/**
 * Login is now two-step when the user has 2FA enabled.
 *
 * Step 1 stays the same: derive auth_key from email + master password,
 * POST /sessions. The server replies with either a TokenPair (no 2FA) or
 * an OtpChallenge (`requires_otp: true`).
 *
 * Step 2 only runs if we got a challenge: prompt the user for an
 * authenticator code, POST /sessions/otp. We hold the master password +
 * KDF params in component state across the two steps so the post-OTP
 * `unlock` call can derive the symmetric key without re-prompting.
 *
 * The held password is wiped from state as soon as the vault key is
 * derived (we set the session and clear local state in the same render).
 */
export function LoginPage() {
  const nav = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const branding = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Phase-2 carry: present only when the server replied with an OTP challenge.
  const [pending, setPending] = useState<{
    otpToken: string;
    kdfParams: KdfParams;
    password: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const kdf = await api.kdfLookup(email);
      const kdfParams: KdfParams = {
        salt: kdf.kdf_salt,
        timeCost: kdf.kdf_time_cost,
        memoryCost: kdf.kdf_memory_cost,
        parallelism: kdf.kdf_parallelism,
      };
      const authKey = await deriveLoginAuthKey(password, kdfParams);
      const resp = await api.login(email, authKey);

      if (isOtpChallenge(resp)) {
        // Carry the master password forward — we still need it after OTP
        // verification to derive the vault symmetric key.
        setPending({ otpToken: resp.otp_token, kdfParams, password });
        return;
      }

      await completeLogin(resp, kdfParams, password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("Invalid email or password.");
      } else if (e instanceof Error && /tag/i.test(e.message)) {
        setError("Vault decryption failed. Wrong password?");
      } else {
        setError("Login failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      const tokens = await api.loginOtp(pending.otpToken, otpCode.trim());
      await completeLogin(tokens, pending.kdfParams, pending.password);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "That code didn't match. Try again or use a recovery code."
          : "Login failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function completeLogin(
    tokens: TokenPair,
    kdfParams: KdfParams,
    pw: string,
  ): Promise<void> {
    const vault: VaultSession = await unlock(
      pw,
      kdfParams,
      tokens.encrypted_symmetric_key,
    );
    setSession({
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      vault,
    });
    setPending(null);
    setOtpCode("");
    setPassword("");
    nav("/vault");
  }

  if (pending) {
    return (
      <main className="auth-container">
        <BrandHeader />
        <h1>Two-factor verification</h1>
        <p className="auth-tagline">
          Enter the 6-digit code from your authenticator app, or one of your
          recovery codes.
        </p>
        <form onSubmit={onSubmitOtp}>
          <label>
            Authenticator code
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="123456 or xxxx-xxxx"
              autoComplete="one-time-code"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || otpCode.trim().length < 4}>
            {busy ? "Verifying…" : "Continue"}
          </button>
        </form>
        <p>
          <button
            type="button"
            className="user-card-action"
            onClick={() => {
              setPending(null);
              setOtpCode("");
              setError(null);
            }}
          >
            ← Start over
          </button>
        </p>
      </main>
    );
  }

  return (
    <main className="auth-container">
      <BrandHeader />
      <h1>Unlock your vault</h1>
      {branding.tagline && <p className="auth-tagline">{branding.tagline}</p>}
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Master password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Unlocking..." : "Unlock"}
        </button>
      </form>
      <p>
        New here? <a href="/register">Create a vault</a>
      </p>
    </main>
  );
}
