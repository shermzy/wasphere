import { Capability } from './capabilities';

export function proxyCapabilityRequirement(method: string, rawPath: string): Capability[] | null {
  const verb = method.toUpperCase();
  const path = rawPath.replace(/^\/+|\/+$/g, '').split('?')[0].replace(/^api\//, '');
  const sessionRead = ['sessions', 'sessions_create'] as Capability[];
  const sessionCollectionRead = ['sessions', 'sessions_create', 'inbox', 'messages'] as Capability[];
  const dashboardFeatureRead = ['sessions', 'inbox', 'messages'] as Capability[];

  if (path === 'health' || path === 'health/live' || path === 'health/ready') {
    return verb === 'GET' ? sessionCollectionRead : null;
  }

  if (verb === 'POST' && (path === 'sessions' || path === 'sessions/meta/test-connection')) {
    return ['sessions_create', 'sessions'];
  }
  if (path === 'sessions') return verb === 'GET' ? sessionCollectionRead : null;
  if (/^bulk\/jobs\/[^/]+$/.test(path)) return verb === 'GET' ? ['messages'] : null;

  if (/^sessions\/[^/]+$/.test(path)) {
    if (verb === 'GET') return sessionRead;
    if (verb === 'DELETE' || verb === 'PATCH') return ['sessions'];
    return null;
  }
  if (/^sessions\/[^/]+\/messages\/.+/.test(path)) {
    return verb === 'POST' || verb === 'DELETE' || verb === 'GET' ? ['messages'] : null;
  }
  if (/^sessions\/[^/]+\/capabilities$/.test(path)) {
    return verb === 'GET' ? dashboardFeatureRead : null;
  }
  if (/^sessions\/[^/]+\/templates(?:\/.*)?$/.test(path)) {
    if (verb === 'GET') return dashboardFeatureRead;
    if (verb === 'POST') return ['sessions'];
    return null;
  }
  if (/^sessions\/[^/]+\/flows$/.test(path)) {
    return verb === 'GET' ? dashboardFeatureRead : null;
  }
  if (/^sessions\/[^/]+\/flows\/send$/.test(path)) {
    return verb === 'POST' ? ['messages'] : null;
  }
  if (/^sessions\/[^/]+\/groups(?:\/.*)?$/.test(path)) {
    return verb === 'GET' || verb === 'POST' || verb === 'PUT' ? ['sessions'] : null;
  }
  if (/^sessions\/[^/]+\/profile(?:\/.*)?$/.test(path)) {
    return verb === 'GET' || verb === 'POST' || verb === 'DELETE' ? ['sessions'] : null;
  }
  if (/^sessions\/[^/]+\/contacts(?:\/.*)?$/.test(path)) {
    return verb === 'GET' || verb === 'POST' ? ['sessions'] : null;
  }
  if (/^sessions\/[^/]+\/logout$/.test(path)) {
    return verb === 'POST' ? ['sessions'] : null;
  }
  if (/^sessions\/[^/]+\/config$/.test(path)) {
    return verb === 'PATCH' ? ['sessions'] : null;
  }
  return null;
}
