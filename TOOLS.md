# Operator tools

This file is the concise runbook for the current WaSphere checkout. Secrets
remain in the deployment secret manager; do not paste them into commands,
logs, or documentation.

## Local development

Requirements: Node.js 22+, pnpm 9, Docker Compose v2, and PostgreSQL 16.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL only
pnpm prisma:migrate
pnpm dev                                          # wa-server, dashboard-api, dashboard-ui
```

The portable stack is `docker compose up -d`. It runs the full stack and binds
the token-protected WA Server host port to loopback by default; see
[README.md](./README.md#services) and [CONFIGURATION.md](./CONFIGURATION.md).

## Build and tests

The commands used by CI are:

```bash
pnpm install --frozen-lockfile
pnpm --filter @wasphere/dashboard-api exec prisma generate
pnpm --filter @wasphere/dashboard-api exec prisma migrate deploy
pnpm --filter @wasphere/dashboard-api test
pnpm --filter @wasphere/wa-server test
pnpm --filter dashboard-ui test
pnpm build
git diff --check
```

`pnpm build` builds all three packages. The dashboard API test command builds
the API before running its Node test suite; the WA Server command type-checks
before running its tests. A local test database can be prepared with
`pnpm --filter @wasphere/dashboard-api test:setup` when Docker is running.

## Health endpoints

Dashboard API:

- `GET /health/live` — process liveness; no dependency check.
- `GET /health/ready` — PostgreSQL readiness; returns `503` when unavailable.
- `GET /health` — PostgreSQL-backed status response.

WA Server:

- `GET /api/health/live` — process liveness.
- `GET /api/health/ready` — readiness; returns `503` until at least one
  WhatsApp session is connected.
- `GET /api/health` — status, version, uptime, and session summary.

## Production deployment: `wa-gateway.t3.group`

The live dashboard is built from this checkout's source repository,
`https://github.com/shermzy/wasphere.git`, branch `main`. A Git push alone does
not deploy it.

1. Run the focused checks above. When an authorized deployment is requested,
   commit and push `main`, then verify that the local `HEAD` and
   `origin/main` resolve to the same full 40-character SHA:

   ```powershell
   git rev-parse HEAD
   git ls-remote origin refs/heads/main
   ```

2. In Coolify, update the saved Compose definition for service
   `wasphere-t3grp` (`ltgc47yg9to4j5w0qrnuoxgh`). Record the previous SHA for
   rollback, then set the Git `build.context` for each of these services to the
   same full-SHA reference:

   ```text
   https://github.com/shermzy/wasphere.git#<40-character-commit-sha>
   ```

   Apply it to `dashboard-api`, `wa-server`, and `dashboard-ui`; save the
   definition and redeploy this service. Do not redeploy the separate
   `wasphere` service. Retrieve `coolify-url` and `coolify-api-key` at runtime
   from Azure Key Vault `t3-secrets`; never print their values.

3. Read back the saved three full-SHA build contexts. Confirm all three
   application containers report `running:healthy`, inspect startup logs, and
   probe:

   ```text
   https://wa-gateway.t3.group/login
   https://wa-gateway-api.t3.group/health
   https://wa-gateway-wa.t3.group/api/health/live
   ```

4. For a user-facing change, verify the actual authenticated flow as well.
   Health responses and a successful redeploy alone do not prove feature
   behavior. A short SHA can leave an old image running, so deployment is not
   complete until the saved full-SHA contexts and runtime behavior are both
   read back.
