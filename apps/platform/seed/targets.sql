INSERT INTO targets (
  id, label, enabled, manifest_revision, created_at, updated_at
) VALUES (
  'DATA', 'Data Worker', 1, 'data-v1', unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  manifest_revision = excluded.manifest_revision,
  updated_at = excluded.updated_at;
