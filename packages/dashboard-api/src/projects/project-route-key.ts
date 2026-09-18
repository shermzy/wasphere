const MAX_ROUTE_KEY_LENGTH = 40;

export function slugifyProjectName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ROUTE_KEY_LENGTH)
    .replace(/-+$/g, '');
  return normalized || 'project';
}

export function normalizeProjectRouteKey(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase();
}
