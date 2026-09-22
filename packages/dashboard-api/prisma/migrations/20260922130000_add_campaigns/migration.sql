CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INDETERMINATE');
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'INDETERMINATE');

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaigns_name_trimmed_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120 AND "name" = btrim("name")),
    CONSTRAINT "campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "target_key" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "display_name" TEXT,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "claimed_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "conversation_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_recipients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "campaign_recipients_campaign_id_target_key_key" ON "campaign_recipients"("campaign_id", "target_key");
CREATE INDEX "campaigns_workspace_id_status_scheduled_at_idx" ON "campaigns"("workspace_id", "status", "scheduled_at");
CREATE INDEX "campaigns_workspace_id_created_at_idx" ON "campaigns"("workspace_id", "created_at" DESC);
CREATE INDEX "campaign_recipients_workspace_id_campaign_id_status_idx" ON "campaign_recipients"("workspace_id", "campaign_id", "status");
