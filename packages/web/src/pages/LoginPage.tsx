import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { deriveLoginAuthKey, unlock } from "@passman/core";

import { ApiError, api } from "../api/client.js";
import { useSession } from "../stores/session.js";

export function LoginPage() {
  const nav = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // 1. Get KDF params (server returns decoy params for unknown emails;
      //    we don't try to detect that here — the login attempt below will fail.)
      const kdf = await api.kdfLookup(email);
      const kdfParams = {
        salt: kdf.kdf_salt,
        timeCost: kdf.kdf_time_cost,
        memoryCost: kdf.kdf_memory_cost,
        parallelism: kdf.kdf_parallelism,
      };

      // 2. Derive auth key client-side and authenticate.
      const authKey = await deriveLoginAuthKey(password, kdfParams);
      const tokens = await api.login(email, authKey);

      // 3. Decrypt the symmetric key with our master key (re-derived inside `unlock`).
      const vault = await unlock(password, kdfParams, tokens.encrypted_symmetric_key);

      setSession({
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        vault,
      });
      nav("/vault");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("Invalid email or password.");
      } else if (e instanceof Error && /tag/i.test(e.message)) {
        // GCM tag mismatch on unlock = wrong password (server accepted us, but
        // our master key can't decrypt the sym key — implies a corrupted record).
        setError("Vault decryption failed. Wrong password?");
      } else {
        setError("Login failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-container">
      <h1>Unlock your vault</h1>
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
