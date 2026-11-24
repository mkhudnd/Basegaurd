import assert from 'node:assert/strict';
import test from 'node:test';
import {personnelCapabilities,personnelInitials,safePersonnelSearch,validatePersonnelPage} from './personnel-domain.ts';

const row={id:'guard-a',display_name:'Rudo Maseko',role:'guard',account_active:true,created_at:'2026-01-01T00:00:00Z',
  duty_status:'off_duty',current_site_id:null,current_post:null,current_shift_started_at:null,last_check_in_at:null,
  site_ids:['site-a'],assignments:[]};
const metrics={total:1,active_accounts:1,on_duty:0,active_assignments:1};

test('personnel search is bounded and safe for the proposed RPC',()=>{
  assert.equal(safePersonnelSearch('  Rudo,(gate).%  '),'Rudo gate');
  assert.equal(safePersonnelSearch('x'.repeat(200)).length,120);
});

test('personnel initials use verified display names without inventing avatars',()=>{
  assert.equal(personnelInitials('Rudo Maseko'),'RM');
  assert.equal(personnelInitials('  Tendai  '),'T');
  assert.equal(personnelInitials(''),'?');
});

test('personnel response rejects records outside the authorized site set',()=>{
  assert.throws(()=>validatePersonnelPage({rows:[row],count:1,metrics},new Set(['site-b']),25),/unauthorized site/);
  assert.doesNotThrow(()=>validatePersonnelPage({rows:[row],count:1,metrics},new Set(['site-a']),25));
});

test('personnel response enforces bounded pagination and metric shape',()=>{
  assert.throws(()=>validatePersonnelPage({rows:[row,row],count:2,metrics},new Set(['site-a']),1),/Invalid/);
  assert.throws(()=>validatePersonnelPage({rows:[row],count:1,metrics:{...metrics,total:'1'}},new Set(['site-a']),25),/metrics/);
});

test('only the existing server-side invitation capability is enabled',()=>{
  assert.deepEqual(personnelCapabilities(),{invite:true,editProfile:false,changeAccountStatus:false,changeAssignments:false,deletePersonnel:false});
});
