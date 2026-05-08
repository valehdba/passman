# Security model

## What the server can see

| Field                      | Visible to server | Notes                                          |
| -------------------------- | ----------------- | ---------------------------------------------- |
| Email                      | ✅ plaintext       | Used as account identifier                     |
| Master password            | ❌ never           | Never leaves client                            |
| Master key                 | ❌ never           | Derived client-side, kept in memory only       |
| Symmetric vault key        | ❌ never           | Encrypted with master key, server stores blob  |
| Auth key                   | ✅ once per request| Server stores Argon2id hash, not the value     |
| KDF parameters             | ✅                 | Salt, time/memory/parallelism — not secret     |
| Vault items (ciphertext)   | ✅                 | AES-GCM blobs only                             |
| Vault item plaintext       | ❌ never           | Only the client (with master password) decrypts |
| Item count                 | ✅                 | Acceptable leak                                |
| Item type (login/note/...) | ✅                 | Acceptable leak                                |

## Threats considered

### Database breach
Attacker pulls a full dump. They have: emails, Argon2 hashes of auth keys,
KDF parameters, encrypted blobs.

To recover any vault data they must brute-force the master password
through Argon2id (client-side params + server-side params, two layers).
With default parameters (64 MiB / 3 iterations on the client + 19 MiB / 2
iterations on the server), each guess costs ≥80 MiB of memory and ≥150 ms
of CPU. A 12-character random password is effectively unbreakable; a
12-character user-chosen password is hard but not impossible — UI enforces
a 12-character minimum to push users away from the worst zone.

Server-side Argon2 parameters (`server_argon2_*` in `config.py`) can be
strengthened over time. Successful logins automatically re-hash the
stored `auth_hash` under the current parameters
(`auth_hash_needs_rehash` → `hash_auth_key`), so an upgrade rolls out
gradually without forcing password resets.

### Compromised server / malicious admin
Same defenses as the breach scenario *for stored data*. A malicious server
can:
- Refuse service.
- Modify/delete vault items (detected by AES-GCM tag — the user sees a
  decryption failure).
- Substitute the encrypted symmetric key blob — the user fails to unlock
  and notices.
- Phish the user via injected JS in the web vault. **Mitigation:** strict
  CSP in `index.html`, served same-origin. The browser extension is the
  primary defense against a phished web vault: it does not depend on the
  web vault.

### Phished web vault
If the attacker ships a hostile JS bundle over the web vault, they can
exfiltrate the master password the user types. Mitigations:
- The browser extension is independent — power users can avoid the web
  vault entirely.
- The CSP forbids inline scripts and remote scripts.
- We recommend HSTS + SRI for production deployments.

### Phished website (autofill attack)
An attacker registers `accounts.google.com.evil.com` and tries to coax the
extension to autofill. Mitigation: **exact-origin matching**. The
extension fills only when `new URL(item.url).origin ===
window.location.origin`. Substring/host-suffix matching is not
implemented.

### Token theft (XSS in some site that hosts the web vault)
Access tokens are JWTs with a 15-minute TTL and a `jti` claim. Refresh
tokens are opaque random 384-bit values, stored only as SHA-256 hashes
server-side. Stealing a refresh token gives an attacker access until the
user logs out (which revokes the specific token).

**Hardening to add later:** rotate refresh tokens on every use with reuse
detection (a re-used token revokes the entire session family).

### Email enumeration
The `/api/accounts/kdf` endpoint returns deterministic decoy parameters
for unknown emails (`HMAC(jwt_secret, email)` truncated to 32 hex chars).
Login also runs a dummy Argon2id verify on the unknown-user path so
response timing doesn't leak existence either.

The `/api/accounts/register` endpoint *does* leak whether an email is
already registered (returns 409). This is a usability/security trade-off
documented in `errors.py`.

### Brute-force login
Currently rate-limited only by Argon2id cost (≥150 ms per attempt).
**Hardening to add later:** per-IP and per-account rate limits with
exponential backoff. The infrastructure for this is present in
`config.py` (`login_attempts_per_15min`) but the middleware isn't yet
wired up.

### Replay attacks
JWTs include `iat`, `exp`, and `jti`. Refresh tokens have a max lifetime
and live-revocation. There is no nonce on individual API calls — TLS is
the assumed transport.

### Side channels
- Argon2id is constant-time by design.
- `argon2-cffi.PasswordHasher.verify` is constant-time.
- Refresh-token comparison uses `hmac.compare_digest`.
- The login path runs Argon2id on a dummy hash for unknown users to
  equalize timing. The dummy hash is generated lazily under the
  *current* server hasher (`passman.auth._dummy_auth_hash`), so it
  always matches the work done for real users — even after operators
  upgrade `server_argon2_*` parameters. A timing-parity regression
  test in CI (`tests/test_auth_timing.py`) re-runs under upgraded
  parameters and asserts the unknown-user vs wrong-password medians
  stay within 0.5x..2.0x of each other.

## What this design does **not** protect against

- Compromise of the user's device while the vault is unlocked.
- Keyloggers / screen recorders / clipboard sniffers.
- A user choosing a weak master password.
- A coerced user (rubber-hose cryptanalysis).
- Government TLS interception with a forged certificate (mitigated by
  HSTS preload + cert pinning, both deployment concerns).

## Reporting a vulnerability

Email the maintainer privately rather than opening a public issue.
Provide a proof of concept and reproduction steps.
