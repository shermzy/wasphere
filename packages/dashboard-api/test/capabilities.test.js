// Pure-logic tests for the workspace capability resolver (no DB).
// Exercises the COMPILED module from dist/ — the same code the guards use.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCapabilities,
  hasCapability,
  sanitizeCapabilities,
  isCapability,
  CAPABILITIES,
} = require('../dist/lib/capabilities');
const { isValidPermissions } = require('../dist/lib/permissions');

test('owner and admin get every capability regardless of role caps', () => {
  for (const role of ['OWNER', 'ADMIN']) {
    const caps = resolveCapabilities(role, []);
    assert.deepEqual([...caps].sort(), [...CAPABILITIES].sort());
    assert.equal(hasCapability(role, [], 'api_keys'), true);
    assert.equal(hasCapability(role, null, 'settings'), true);
  }
});

test('member capabilities are exactly their role capabilities', () => {
  assert.deepEqual(resolveCapabilities('MEMBER', ['inbox', 'contacts']).sort(), ['contacts', 'inbox']);
  assert.equal(hasCapability('MEMBER', ['inbox', 'contacts'], 'inbox'), true);
  assert.equal(hasCapability('MEMBER', ['inbox', 'contacts'], 'webhooks'), false);
});

test('member with no role has no capabilities', () => {
  assert.deepEqual(resolveCapabilities('MEMBER', null), []);
  assert.deepEqual(resolveCapabilities('MEMBER', []), []);
  assert.equal(hasCapability('MEMBER', null, 'inbox'), false);
});

test('a role can grant any capability, including sensitive ones', () => {
  assert.equal(hasCapability('MEMBER', ['api_keys', 'webhooks'], 'api_keys'), true);
  assert.equal(hasCapability('MEMBER', ['api_keys', 'webhooks'], 'webhooks'), true);
  assert.equal(hasCapability('MEMBER', ['api_keys'], 'settings'), false);
});

test('projects and contact API-key scopes are explicit least-privilege grants', () => {
  assert.equal(hasCapability('MEMBER', ['projects'], 'projects'), true);
  assert.equal(hasCapability('MEMBER', ['inbox'], 'projects'), false);
  assert.equal(isValidPermissions(['contacts:read']), true);
  assert.equal(isValidPermissions(['contacts:write']), true);
});

test('a member can be granted session creation without session administration', () => {
  assert.equal(hasCapability('MEMBER', ['sessions_create'], 'sessions_create'), true);
  assert.equal(hasCapability('MEMBER', ['sessions_create'], 'sessions'), false);
});

test('sanitizeCapabilities drops invalid values and dedupes', () => {
  assert.deepEqual(sanitizeCapabilities(['inbox', 'inbox', 'nonsense', 42, 'settings']).sort(), ['inbox', 'settings']);
  assert.deepEqual(sanitizeCapabilities(null), []);
  assert.deepEqual(sanitizeCapabilities('inbox'), []);
  assert.equal(isCapability('team'), false);
});
