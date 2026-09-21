ALTER TABLE "project_routes" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "project_route_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_route_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "route_key" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "target_jid" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_route_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_route_audit_workspace_id_created_at_idx"
  ON "project_route_audit"("workspace_id", "created_at" DESC);

ALTER TABLE "project_route_audit"
  ADD CONSTRAINT "project_route_audit_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
