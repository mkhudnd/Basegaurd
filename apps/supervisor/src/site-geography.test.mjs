import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryFromVertices, parsePosition, siteSaveMessage} from './site-geography.ts';
import {geographicSites, visiblePositions} from './operations-geography.ts';

test('optional center preserves longitude-first order and rejects invalid positions', () => {
  assert.equal(parsePosition('', ''), null);
  assert.deepEqual(parsePosition('31.12', '-17.8'), [31.12, -17.8]);
  assert.throws(() => parsePosition('31', ''));
  assert.throws(() => parsePosition('181', '20'));
  assert.throws(() => parsePosition('31', '-91'));
});

test('a valid perimeter closes without mutating editable vertices or requiring a center', () => {
  const vertices = [[31, -18], [32, -18], [32, -17]];
  assert.equal(boundaryFromVertices([]), null);
  assert.deepEqual(boundaryFromVertices(vertices),
    {type: 'Polygon', coordinates: [[[31, -18], [32, -18], [32, -17], [31, -18]]]});
  assert.equal(vertices.length, 3);
});

test('invalid perimeters fail the local preview check', () => {
  assert.throws(() => boundaryFromVertices([[0, 0], [1, 1]]), /3 to 256/);
  assert.throws(() => boundaryFromVertices([[0, 0], [2, 2], [0, 2], [2, 0]]), /intersect/);
  assert.throws(() => boundaryFromVertices([[0, 0], [2, 0], [1, 0], [0, 2]]), /doubles back|intersect/);
  assert.throws(() => boundaryFromVertices([[179, 0], [-179, 0], [-179, 1]]), /antimeridian/);
});

test('conflicts, permissions, and unsafe deactivation surface actionable errors', () => {
  assert.match(siteSaveMessage({code: 'PT409'}), /refresh/);
  assert.match(siteSaveMessage({code: '42501'}), /cannot/);
  assert.match(siteSaveMessage({code: '23514', message: 'Site has active or scheduled shifts or unresolved incidents'}), /unresolved/);
});

test('the operations map includes authorized active boundary-only sites and their active posts', () => {
  const boundary = boundaryFromVertices([[31, -18], [32, -18], [32, -17]]);
  const point = {type: 'Point', coordinates: [31.4, -17.8]};
  const sites = [
    {id: 'permitted', is_active: true, center: null, boundary},
    {id: 'inactive', is_active: false, center: point},
    {id: 'out-of-scope', is_active: true, center: point},
    {id: 'no-location', is_active: true, center: {type: 'Point', coordinates: [0, 89]}},
  ];
  const posts = [
    {id: 'active', site_id: 'permitted', is_active: true, location: point, outside_boundary: true},
    {id: 'inactive', site_id: 'permitted', is_active: false, location: point},
    {id: 'outside-scope', site_id: 'out-of-scope', is_active: true, location: point},
    {id: 'unlocated', site_id: 'no-location', is_active: true, location: null},
  ];
  const result = geographicSites(new Set(['permitted', 'inactive', 'no-location']), sites, posts);
  assert.deepEqual(result.map(site => site.id), ['permitted', 'no-location']);
  assert.deepEqual(result[0].posts.map(post => post.id), ['active']);
  assert.equal(result[0].posts[0].outside_boundary, true);
  assert.deepEqual(visiblePositions(result[0], {sites: true, boundaries: false, posts: false}), []);
  assert.deepEqual(visiblePositions(result[0], {sites: false, boundaries: true, posts: false}), boundary.coordinates[0]);
  assert.deepEqual(visiblePositions(result[0], {sites: false, boundaries: false, posts: true}), [point.coordinates]);
  assert.deepEqual(visiblePositions(result[1], {sites: true, boundaries: true, posts: true}), []);
});
