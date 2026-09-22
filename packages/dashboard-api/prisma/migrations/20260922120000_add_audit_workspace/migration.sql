ALTER TABLE "audit_logs"
ADD COLUMN "workspace_id" UUID;

CREATE INDEX "audit_logs_workspace_id_timestamp_idx"
  ON "audit_logs"("workspace_id", "timestamp" DESC);

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
