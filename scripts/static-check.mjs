import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/schema.sql');
const expected=['profiles','sites','site_assignments','shifts','occurrence_entries','occurrence_amendments','incidents','incident_updates','shift_handovers','sync_receipts','audit_events'];
for(const name of expected){
 assert.match(sql,new RegExp(`create table if not exists public\\.${name}\\b`),`${name} table missing`);
 assert.match(sql,new RegExp(`alter table public\\.${name} enable row level security`),`${name} RLS missing`);
}
for(const rpc of ['submit_ob_entry','submit_incident','acknowledge_incident']){
 assert.match(sql,new RegExp(`function public\\.${rpc}\\(`),`${rpc} RPC missing`);
 assert.match(sql,new RegExp(`grant execute on function public\\.${rpc}\\(`),`${rpc} grant missing`);
}
assert.match(sql,/on conflict\(id\) do nothing/,'Idempotent insert missing');
assert.match(sql,/Not authorized for this site/,'Guard authorization missing');
assert.match(sql,/set search_path = ''/,'Secured function search path missing');
assert.match(read('apps/guard/app.json'),/useSQLCipher/,'SQLCipher native config missing');
assert.match(read('apps/guard/src/offline.ts'),/state='received'/,'Received-state sync handling missing');
assert.match(read('apps/guard/src/ReportIncidentScreen.tsx'),/approved emergency telephone\/radio procedures/,'Urgent escalation reminder missing');
console.log(`PASS: ${expected.length} RLS tables, 3 restricted RPCs, local outbox & emergency warning (static checks only).`);
