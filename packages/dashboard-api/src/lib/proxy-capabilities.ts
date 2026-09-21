import { Capability } from './capabilities';

export function proxyCapabilityRequirement(method: string, rawPath: string): Capability[] | null {
  const verb = method.toUpperCase();
  const path = rawPath.replace(/^\/+|\/+$/g, '').split('?')[0].replace(/^api\//, '');

  if (verb === 'POST' && (path === 'sessions' || path === 'sessions/meta/test-connection')) {
    return ['sessions_create', 'sessions'];
  }
  if (
    (verb === 'DELETE' && /^sessions\/[^/]+$/.test(path)) ||
    (verb === 'POST' && /^sessions\/[^/]+\/logout$/.test(path)) ||
    (verb === 'PATCH' && /^sessions\/[^/]+(?:\/config)?$/.test(path))
  ) {
    return ['sessions'];
  }
  return null;
}
