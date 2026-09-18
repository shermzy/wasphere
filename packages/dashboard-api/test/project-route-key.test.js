const test = require('node:test');
const assert = require('node:assert/strict');

const { slugifyProjectName, normalizeProjectRouteKey } = require('../dist/projects/project-route-key');

test('generates a stable route key from the initial display name', () => {
  assert.equal(slugifyProjectName('Project A'), 'project-a');
  assert.equal(slugifyProjectName('  Café / Launch  '), 'cafe-launch');
  assert.equal(slugifyProjectName('!!!'), 'project');
  assert.equal(slugifyProjectName('A'.repeat(60)), 'a'.repeat(40));
});

test('normalizes agent route keys without changing their meaning', () => {
  assert.equal(normalizeProjectRouteKey('#Project-A'), 'project-a');
  assert.equal(normalizeProjectRouteKey('##PROJECT-A'), 'project-a');
  assert.equal(normalizeProjectRouteKey('  project-a  '), 'project-a');
});
