-- Project routes map one stable agent route to one WhatsApp conversation.
CREATE TABLE "project_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "route_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "project_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_routes_conversation_id_key" ON "project_routes"("conversation_id");
CREATE UNIQUE INDEX "project_routes_workspace_id_route_key_key" ON "project_routes"("workspace_id", "route_key");
CREATE INDEX "project_routes_workspace_id_idx" ON "project_routes"("workspace_id");

ALTER TABLE "project_routes"
  ADD CONSTRAINT "project_routes_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_routes"
  ADD CONSTRAINT "project_routes_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_routes"
  ADD CONSTRAINT "project_routes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
