import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../../../',import.meta.url);
const schema=await readFile(new URL('supabase/schema.sql',root),'utf8');
const photo=await readFile(new URL('supabase/migrations/202611190003_incident_photo.sql',root),'utf8');
const closeProposal=await readFile(new URL('supabase/proposals/incident_close.sql',root),'utf8');

test('incident reads remain constrained by guard ownership or supervisor site access',()=>{
  assert.match(schema,/create policy incidents_allowed[\s\S]*reporter_id=.*auth\.uid\(\)[\s\S]*private\.has_site_access\(site_id,array\['supervisor','admin'\]/i);
});

test('private evidence metadata and objects require incident authorization',()=>{
  assert.match(photo,/values\('incident-evidence','incident-evidence',false/i);
  assert.match(photo,/create policy incident_photos_read[\s\S]*private\.has_site_access\(i\.site_id,array\['supervisor','admin'\]/i);
  assert.match(photo,/create policy incident_photo_read on storage\.objects[\s\S]*bucket_id='incident-evidence'[\s\S]*private\.has_site_access/i);
});

test('proposed close action requires resolved state and authorized site access',()=>{
  assert.match(closeProposal,/private\.has_site_access\(v_incident\.site_id,array\['supervisor','admin'\]/i);
  assert.match(closeProposal,/v_incident\.status<>'resolved'/i);
  assert.match(closeProposal,/revoke all on function public\.close_incident[\s\S]*from public,anon,authenticated/i);
});
