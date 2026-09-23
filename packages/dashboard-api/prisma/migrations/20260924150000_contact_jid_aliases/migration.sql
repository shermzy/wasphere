CREATE TABLE "contact_jid_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "alias_jid" TEXT NOT NULL,
    "canonical_jid" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_jid_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_jid_aliases_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contact_jid_aliases_workspace_id_session_id_alias_jid_key"
    ON "contact_jid_aliases"("workspace_id", "session_id", "alias_jid");
CREATE INDEX "contact_jid_aliases_workspace_id_session_id_canonical_jid_idx"
    ON "contact_jid_aliases"("workspace_id", "session_id", "canonical_jid");
