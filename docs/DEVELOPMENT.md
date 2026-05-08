# Development

## Required environment

- Python 3.11+
- Node.js 20+
- Docker (for local Postgres)

If you haven't gone through the install steps yet, do that first —
[`README.md`](../README.md#installation) walks through the full setup
including environment variable configuration. This document picks up
where that leaves off.

## First-time setup (terse, for repeat clones)

```bash
git clone <repo>
cd passman
docker compose up -d

# Backend
cd server
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp ../.env.example ../.env
# Edit ../.env — set JWT_SECRET to `openssl rand -hex 64`
alembic upgrade head
uvicorn passman.main:app --reload --port 8000

# TS workspaces (new terminal, repo root)
npm install
npm run build --workspace=@passman/core   # core must be built first
npm run dev   --workspace=@passman/web    # http://localhost:5173
```

## Common commands

| Task                       | Command                                                  |
| -------------------------- | -------------------------------------------------------- |
| Run server tests           | `cd server && pytest`                                    |
| Lint Python                | `cd server && ruff check src tests`                      |
| Format Python              | `cd server && ruff format src tests`                     |
| Run TS tests               | `npm test --workspaces --if-present`                     |
| Typecheck TS               | `npm run typecheck --workspaces --if-present`            |
| Build core (required for dependents) | `npm run build --workspace=@passman/core`      |
| Build web                  | `npm run build --workspace=@passman/web`                 |
| Generate new migration     | `cd server && alembic revision --autogenerate -m "..."`  |
| Apply migrations           | `cd server && alembic upgrade head`                      |
| Rollback one migration     | `cd server && alembic downgrade -1`                      |
| Audit Python deps          | `cd server && pip-audit`                                 |
| Audit npm deps             | `npm audit`                                              |

## Testing strategy

- **Unit tests** (`server/tests/`, `packages/*/tests/`) run on every PR.
  They use SQLite for the backend and never touch the network.
- **Timing-parity test** (`server/tests/test_auth_timing.py`) runs a
  second time in CI under upgraded Argon2 parameters
  (`SERVER_ARGON2_*`), guarding the login dummy-verify mechanism that
  closes the email-enumeration timing oracle.
- **Integration test** (`packages/core/tests/integration.test.ts`) is
  skipped unless `PASSMAN_INTEGRATION_URL` is set — CI sets this after
  starting a real server with a real Postgres.
- **Security audit** workflow runs `pip-audit` (Python) and
  `npm audit` (TS) on every PR and weekly on a cron, blocking on
  high-severity advisories in production deps.
- **CodeQL** runs weekly on a schedule + on every push to `main`.

## Adding a new vault field

1. Update `VaultLoginPlaintext` in `packages/core/src/types.ts`.
2. Bump the schema version handling in `packages/core/src/account.ts`
   (`decryptVaultLogin` should accept old shapes if you want backward
   compatibility).
3. Update the web UI in `packages/web/src/pages/VaultPage.tsx`.
4. **No backend change required** — the server stores opaque ciphertext.

## Commit guidelines

- Conventional commits encouraged: `feat:`, `fix:`, `refactor:`,
  `docs:`, `test:`, `ci:`, `chore:`, `style:`.
- Sign commits with GPG when possible: `git commit -S`.
- Run `pytest`, `ruff check`, `ruff format --check`, and
  `npm run typecheck --workspaces` before pushing — it's cheaper than
  fixing CI.
- Keep commits atomic: one logical concern per commit. Reviewers can
  squash on merge if they prefer a single-commit history.

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
