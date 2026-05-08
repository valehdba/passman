# Architecture

## Goals

1. **Zero-knowledge.** A full database breach should not reveal any vault
   contents, master passwords, or encryption keys.
2. **Standard primitives.** Argon2id (RFC 9106) for KDF, AES-256-GCM for
   authenticated encryption — no custom crypto.
3. **Browser autofill.** A Manifest V3 extension that fills credentials only
   on exact-origin matches, defeating common phishing patterns.
4. **Auditability.** Every commit runs CI: lint, typecheck, unit tests, E2E
   tests against a real Postgres, CodeQL.

## Stack

| Layer       | Choice                                       | Why                                                                |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Backend     | Python 3.11 / FastAPI / SQLAlchemy 2.0 async | Modern async, OpenAPI for free, strict types.                      |
| Database    | PostgreSQL 16                                | Mature, transactional, supports `UUID` natively.                   |
| Migrations  | Alembic                                      | Async-aware, integrated with SQLAlchemy.                           |
| Server hash | `argon2-cffi`                                | Reference Argon2 implementation.                                   |
| Web         | React 18 + Vite                              | Standard SPA tooling.                                              |
| Extension   | Chrome MV3                                   | Required for new submissions; service worker is restartable.       |
| Client KDF  | `hash-wasm` (Argon2id WASM)                  | Same algorithm in browser/SW/Node, no Native deps.                 |
| Client AEAD | Web Crypto API (AES-GCM)                     | Available everywhere we run; non-extractable `CryptoKey` handles.  |

## Zero-knowledge flow

### Registration

```
client                                                   server
──────                                                   ──────
1. password ─┐
2. salt ← random(16 bytes)                               (no traffic yet)
3. masterKey ← Argon2id(password, salt, params)
4. authKey ← Argon2id(masterKey, salt=password, lite)
5. symKey ← random(32 bytes)
6. encSymKey ← AES-GCM(symKey, key=masterKey, IV=random(12))
7. POST /api/accounts/register
   { email, kdf_salt, kdf_*, auth_key=authKey, encrypted_symmetric_key=encSymKey }
                                                         8. authHash ← Argon2id(authKey)
                                                         9. INSERT users
                                                            (email, authHash, kdf_*, encSymKey)
```

The server **never** sees `password`, `masterKey`, or `symKey` — only
ciphertext and the one-way-derived `authKey` (which it then hashes again).

### Login

```
client                                                   server
──────                                                   ──────
GET /api/accounts/kdf?email=...
                                                         (returns real or decoy params —
                                                          decoy is HMAC(jwt_secret, email)
                                                          so unknown users are
                                                          indistinguishable from known ones)
masterKey ← Argon2id(password, kdf_salt, params)
authKey   ← Argon2id(masterKey, password)
POST /api/sessions { email, auth_key=authKey }
                                                         verify Argon2id(authKey) ?= authHash
                                                         (constant-time; on failure runs a
                                                          dummy verify so timing matches)
                                                  ◀── { access_token (JWT, 15min, with jti),
                                                        refresh_token (opaque, 30d),
                                                        encrypted_symmetric_key }
symKey ← AES-GCM-decrypt(encSymKey, key=masterKey)
   (kept as non-extractable CryptoKey in memory only;
    raw bytes are zeroed via Uint8Array.fill(0))
```

### Vault item I/O

```
create:  ciphertext ← AES-GCM(JSON({name, username, password, url, ...}),
                              key=symKey, IV=random(12))
         POST /api/vault/items { item_type, encrypted_data: ciphertext }

list:    GET /api/vault/items → returns ciphertext blobs
         client decrypts each one with symKey
```

## Data model

```
users
  id                       uuid PK
  email                    text UNIQUE
  auth_hash                text  (argon2id PHC string)
  kdf_salt                 text  (base64, 16 bytes)
  kdf_time_cost            int
  kdf_memory_cost          int   (KiB)
  kdf_parallelism          int
  encrypted_symmetric_key  text  ("v1:<iv-b64>:<ciphertext-b64>")
  created_at, updated_at   timestamptz

vault_items
  id            uuid PK
  user_id       uuid FK → users(id) ON DELETE CASCADE
  item_type     text  ('login' | 'note' | 'card' | 'identity')
  encrypted_data text ("v1:<iv-b64>:<ciphertext-b64>", ≤ 64 KiB)
  created_at, updated_at  timestamptz
  INDEX (user_id, item_type)

sessions
  id                  uuid PK
  user_id             uuid FK
  refresh_token_hash  text  (sha256 hex of refresh token)
  expires_at          timestamptz
  user_agent          text
  revoked_at          timestamptz NULL
  INDEX (refresh_token_hash) UNIQUE
```

`item_type` is the only metadata stored in cleartext. We deliberately leak
the count and category of items but nothing else.

## Browser extension

The Manifest V3 service worker holds the unlocked `VaultSession` (a
non-extractable `CryptoKey`) in memory. Chrome's worker idle policy means
the extension auto-locks after ~30s of inactivity — accepted as a
security feature.

**Anti-phishing:** the content script and background only match items
where `new URL(item.url).origin === window.location.origin`. Suffix
matching (`*.example.com`) is *not* implemented — it's the standard
attacker entry point against password managers.

**No silent autofill.** The user must click an item in the inline picker
before any credential is filled. This defeats invisible-input phishing
attacks.

## API surface

| Method | Path                          | Auth     | Purpose                                |
| ------ | ----------------------------- | -------- | -------------------------------------- |
| POST   | `/api/accounts/register`      | none     | Create account                         |
| GET    | `/api/accounts/kdf?email=...` | none     | Get KDF params (decoy if unknown)      |
| POST   | `/api/sessions`               | none     | Login; returns tokens + encSymKey      |
| POST   | `/api/sessions/refresh`       | refresh  | New access token                       |
| DELETE | `/api/sessions`               | bearer   | Revoke a refresh token                 |
| GET    | `/api/vault/items`            | bearer   | List user's vault items (ciphertext)   |
| POST   | `/api/vault/items`            | bearer   | Create vault item                      |
| GET    | `/api/vault/items/{id}`       | bearer   | Read vault item                        |
| PATCH  | `/api/vault/items/{id}`       | bearer   | Update vault item                      |
| DELETE | `/api/vault/items/{id}`       | bearer   | Delete vault item                      |
| GET    | `/healthz`                    | none     | Liveness probe                         |

OpenAPI is available at `/docs` when the server is running.
