export function normalizeProjectRouteKey(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase();
}
