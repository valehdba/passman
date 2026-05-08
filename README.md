# Passman

A zero-knowledge password manager. Vault data is encrypted on the client with
a key derived from your master password, and the server only ever stores
ciphertext + KDF parameters. A database breach leaks nothing usable.

```
┌─────────────────┐  auth_key (one-way)   ┌───────────────────┐
│   Web vault     │ ────────────────────▶ │  FastAPI server   │
│   (React)       │ ◀──────────────────── │  PostgreSQL       │
│                 │  encrypted blobs only │  Argon2id hash    │
└─────────────────┘                       └───────────────────┘
        ▲
        │  shares @passman/core (Argon2id KDF + AES-GCM)
        ▼
┌─────────────────┐
│ Browser ext.    │ — Manifest V3, exact-origin autofill
│ (Chrome MV3)    │
└─────────────────┘
```

## Repository layout

| Path                  | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `server/`             | Python FastAPI backend (zero-knowledge auth + vault CRUD).   |
| `packages/core/`      | Shared TypeScript crypto: Argon2id KDF, AES-256-GCM.         |
| `packages/web/`       | React/Vite vault UI.                                         |
| `packages/extension/` | Manifest V3 Chrome extension for autofill.                   |
| `.github/workflows/`  | CI: lint, typecheck, unit + E2E tests, CodeQL, author guard. |
| `docs/`               | Architecture and security docs.                              |

Read the full design in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
threat model in [`docs/SECURITY.md`](docs/SECURITY.md).

## Quick start

Prerequisites: Node 20+, Python 3.11+, Docker (for Postgres).

```bash
# 1. Start Postgres
docker compose up -d

# 2. Backend
cd server
cp ../.env.example ../.env          # then edit .env (set JWT_SECRET)
pip install -e ".[dev]"
alembic upgrade head
uvicorn passman.main:app --reload --port 8000

# 3. Web vault (new terminal)
cd packages/core && npm install && npm run build
cd ../web && npm run dev             # http://localhost:5173

# 4. Browser extension
cd packages/extension
npm run build
# In Chrome: chrome://extensions → Developer mode → Load unpacked → packages/extension/dist
```

## Testing

```bash
# Backend: 19 tests, ~83% coverage
cd server && pytest

# TS packages: 25 unit tests + skip-by-default E2E
npm test --workspaces --if-present

# Full E2E (TS client → live Python server) — what CI runs:
PASSMAN_INTEGRATION_URL=http://localhost:8000 npm test --workspace=@passman/core
```

## Contributing

All commits must be authored by **valeh.agayev@gmail.com (valehdba)**. CI
enforces this with [`.github/workflows/commit-author.yml`](.github/workflows/commit-author.yml).

```bash
git config user.email "valeh.agayev@gmail.com"
git config user.name  "valehdba"
```

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full workflow.

## Security

- **Found a vulnerability?** Email the maintainer privately rather than opening
  a public issue.
- **Rotated a token by accident?** Treat any token shared in chat, screenshots,
  or uploaded files as compromised. Revoke at <https://github.com/settings/tokens>.
- See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model.

## License

TBD — add a `LICENSE` file before publishing.
