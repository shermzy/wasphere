UPDATE "custom_roles"
SET
  "capabilities" = "capabilities" || '["sessions_create"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE lower("name") = 'agent'
  AND NOT ("capabilities" ? 'sessions_create');
