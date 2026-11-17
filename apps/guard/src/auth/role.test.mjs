import test from 'node:test';
import assert from 'node:assert/strict';
import {roleForProfile, cachedOfflineRole} from './role.ts';

test('only explicitly active, server-provisioned roles are accepted', () => {
  for (const role of ['guard', 'supervisor', 'admin']) {
    assert.equal(roleForProfile({role, is_active:true}), role);
  }
  assert.throws(() => roleForProfile(null));
  assert.throws(() => roleForProfile({role:'supervisor', is_active:false}));
  assert.throws(() => roleForProfile({role:'owner', is_active:true}));
});

test('offline cache cannot elevate privileges or bypass online verification', () => {
  assert.equal(cachedOfflineRole(false, 'guard'), 'guard');
  assert.equal(cachedOfflineRole(true, 'guard'), null);
  assert.equal(cachedOfflineRole(false, 'supervisor'), null);
  assert.equal(cachedOfflineRole(false, 'admin'), null);
  assert.equal(cachedOfflineRole(false, null), null);
});
