import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../../../',import.meta.url);
const proposal=await readFile(new URL('supabase/proposals/site_personnel_directory.sql',root),'utf8');
const invite=await readFile(new URL('supabase/functions/invite-guard/index.ts',root),'utf8');
const workspace=await readFile(new URL('apps/supervisor/src/PersonnelWorkspace.tsx',root),'utf8');
const proposalSql=proposal.replace(/^--.*$/gm,'');

test('personnel identity proposal is site scoped and exposes no auth contact data',()=>{
  assert.match(proposal,/private\.has_site_access\([\s\S]*array\['supervisor','admin'\]/i);
  assert.match(proposal,/profile\.display_name[\s\S]*profile\.is_active/i);
  assert.doesNotMatch(proposalSql,/auth\.users|email|phone|service_role/i);
});

test('directory RPC is security invoker with explicit execute restrictions',()=>{
  assert.match(proposal,/list_site_personnel[\s\S]*security invoker/i);
  assert.doesNotMatch(proposal,/list_site_personnel[\s\S]*security definer/i);
  assert.match(proposal,/revoke all on function public\.list_site_personnel[\s\S]*from public,anon,authenticated/i);
});

test('guard invitation keeps privileged auth administration server-side',()=>{
  assert.match(invite,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(invite,/admin\.auth\.admin\.inviteUserByEmail/);
  assert.match(invite,/hasValidAssignment[\s\S]*Not authorized to manage this site/i);
  assert.doesNotMatch(proposal,/SUPABASE_SERVICE_ROLE_KEY|inviteUserByEmail/);
});

test('proposal contains no personnel mutation or deletion function',()=>{
  assert.doesNotMatch(proposal,/update\s+public\.profiles|delete\s+from\s+public\.profiles|insert\s+into\s+public\.profiles/i);
});

test('personnel requests abort and reject stale responses during scope changes',()=>{
  assert.match(workspace,/new AbortController\(\)/);
  assert.match(workspace,/if\(request\.signal\.aborted\)return/);
  assert.match(workspace,/return\(\)=>request\.abort\(\)/);
});
