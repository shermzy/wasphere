const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeProjectRouteKey } = require('../dist/projects/project-route-key');

test('normalizes agent route keys without changing their meaning', () => {
  assert.equal(normalizeProjectRouteKey('#Project-A'), 'project-a');
  assert.equal(normalizeProjectRouteKey('##PROJECT-A'), 'project-a');
  assert.equal(normalizeProjectRouteKey('  project-a  '), 'project-a');
});
