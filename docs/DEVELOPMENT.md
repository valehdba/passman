# Development

## Required environment

- Python 3.11+
- Node.js 20+
- Docker (for local Postgres)
- Git configured with `valeh.agayev@gmail.com` (CI rejects other authors)

```bash
git config user.email "valeh.agayev@gmail.com"
git config user.name  "valehdba"
```

## First-time setup

```bash
git clone <repo>
cd passman

# Postgres
docker compose up -d

# Python backend
cd server
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp ../.env.example ../.env
# Edit ../.env — set JWT_SECRET to `openssl rand -hex 64`

alembic upgrade head
uvicorn passman.main:app --reload --port 8000

# In another terminal — TS workspaces
cd ..
npm install
npm run build --workspace=@passman/core   # core must be built before web/ext
cd packages/web && npm run dev            # http://localhost:5173
```

## Common commands

| Task                       | Command                                           |
| -------------------------- | ------------------------------------------------- |
| Run server tests           | `cd server && pytest`                             |
| Run server tests + coverage| `cd server && pytest`                             |
| Lint Python                | `cd server && ruff check src tests`               |
| Format Python              | `cd server && ruff format src tests`              |
| Run TS tests               | `npm test --workspaces --if-present`              |
| Typecheck TS               | `npm run typecheck --workspaces --if-present`     |
| Build TS                   | `npm run build --workspace=@passman/core` (etc.)  |
| Generate new migration     | `cd server && alembic revision --autogenerate -m "..."` |
| Apply migrations           | `cd server && alembic upgrade head`               |
| Rollback one migration     | `cd server && alembic downgrade -1`               |

## Testing strategy

- **Unit tests** (`server/tests/`, `packages/*/tests/`) run on every PR.
  They use SQLite for the backend and never touch the network.
- **Integration test** (`packages/core/tests/integration.test.ts`) is
  skipped unless `PASSMAN_INTEGRATION_URL` is set — CI sets this after
  starting a real server with a real Postgres.
- **CodeQL** runs weekly on a schedule + on every push to `main`.

## Adding a new vault field

1. Update `VaultLoginPlaintext` in `packages/core/src/types.ts`.
2. Bump the schema version handling in `packages/core/src/account.ts`
   (`decryptVaultLogin` should accept old shapes if you want backward
   compatibility).
3. Update the web UI in `packages/web/src/pages/VaultPage.tsx`.
4. **No backend change required** — the server stores opaque ciphertext.

## Commit guidelines

- All commits must use `valeh.agayev@gmail.com`. Enforced in CI.
- Conventional commits encouraged (`feat:`, `fix:`, `docs:`, etc.).
- Sign commits with GPG when possible: `git commit -S`.
- Run `pytest`, `ruff check`, and `npm run typecheck --workspaces` before
  pushing — it's cheaper than fixing CI.

## Deploy notes

For production:

1. Set `ENV=production` and a strong `JWT_SECRET` (the config refuses to
   start otherwise).
2. Front the API with TLS (nginx/Caddy/Cloudflare).
3. Serve the web vault from a separate origin and configure
   `CORS_ORIGINS` accordingly.
4. Run the alembic migrations as a separate step before booting workers.
5. Consider rate-limiting at the edge as well as in-app.
6. Rotate `JWT_SECRET` periodically — note this invalidates existing
   sessions, which is expected.
