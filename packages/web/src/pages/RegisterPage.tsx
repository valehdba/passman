import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { buildRegistration } from "@passman/core";

import { ApiError, api } from "../api/client.js";

export function RegisterPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Master password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const reg = await buildRegistration(email, password);
      await api.register({
        email: reg.email,
        auth_key: reg.authKey,
        encrypted_symmetric_key: reg.encryptedSymmetricKey,
        kdf_salt: reg.kdfSalt,
        kdf_time_cost: reg.kdfTimeCost,
        kdf_memory_cost: reg.kdfMemoryCost,
        kdf_parallelism: reg.kdfParallelism,
      });
      nav("/login", { state: { justRegistered: true } });
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Registration failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-container">
      <h1>Create your vault</h1>
      <p className="warning">
        ⚠️ Your master password is the only key. We can't recover it. If you
        forget it, your vault is permanently inaccessible.
      </p>
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
            autoComplete="new-password"
            minLength={12}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Creating vault..." : "Create vault"}
        </button>
      </form>
    </main>
  );
}
