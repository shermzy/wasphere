CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automation_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "automation_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TYPE "AutomationRunStatus" AS ENUM ('CLAIMED', 'SENT', 'FAILED', 'INDETERMINATE', 'SKIPPED');

CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "automation_rule_id" UUID NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'CLAIMED',
    "error_message" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "automation_runs_automation_rule_id_fkey" FOREIGN KEY ("automation_rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "automation_runs_workspace_id_automation_rule_id_provider_message_id_key"
    ON "automation_runs"("workspace_id", "automation_rule_id", "provider_message_id");
CREATE INDEX "automation_rules_workspace_id_provider_session_id_enabled_idx"
    ON "automation_rules"("workspace_id", "provider_session_id", "enabled");
CREATE INDEX "automation_rules_workspace_id_created_at_idx"
    ON "automation_rules"("workspace_id", "created_at" DESC);
CREATE INDEX "automation_runs_workspace_id_created_at_idx"
    ON "automation_runs"("workspace_id", "created_at" DESC);
CREATE INDEX "automation_runs_workspace_id_automation_rule_id_created_at_idx"
    ON "automation_runs"("workspace_id", "automation_rule_id", "created_at" DESC);
