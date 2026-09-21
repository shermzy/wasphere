CREATE TABLE "workspace_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_sessions_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_sessions_provider_session_id_key"
  ON "workspace_sessions"("provider_session_id");
CREATE UNIQUE INDEX "workspace_sessions_workspace_id_provider_session_id_key"
  ON "workspace_sessions"("workspace_id", "provider_session_id");
CREATE INDEX "workspace_sessions_workspace_id_idx"
  ON "workspace_sessions"("workspace_id");

-- Preserve ownership for sessions already observed by the inbox.
INSERT INTO "workspace_sessions" ("workspace_id", "provider_session_id")
SELECT DISTINCT "workspace_id", "session_id"
FROM "conversations"
ON CONFLICT ("provider_session_id") DO NOTHING;

-- A self-hosted deployment uses one WA Server connection. Reuse it only when
-- the owner has exactly one configured source; session access is isolated by
-- workspace_sessions at the dashboard proxy boundary.
WITH owner_defaults AS (
  SELECT "owner_id",
         MIN("id"::text)::uuid AS source_id
  FROM "workspaces"
  WHERE "wa_server_url" IS NOT NULL
    AND "wa_server_token" IS NOT NULL
    AND "wa_server_token_iv" IS NOT NULL
  GROUP BY "owner_id"
  HAVING COUNT(*) = 1
)
UPDATE "workspaces" AS target
SET "wa_server_url" = source."wa_server_url",
    "wa_server_token" = source."wa_server_token",
    "wa_server_token_iv" = source."wa_server_token_iv"
FROM owner_defaults defaults
JOIN "workspaces" AS source ON source."id" = defaults.source_id
WHERE target."owner_id" = defaults."owner_id"
  AND target."wa_server_url" IS NULL
  AND target."wa_server_token" IS NULL
  AND target."wa_server_token_iv" IS NULL;
