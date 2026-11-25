import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './api';
import {syncPending} from './sync-engine';
import {handoverTable,replayHandovers} from './handover-outbox';
import {makeQueuedPayload} from './incident-domain';
import {syncPhotos} from './photo-sync';

export type Kind = 'occurrence' | 'incident';
export type SyncState = 'queued' | 'sending' | 'failed' | 'received';
export type LocalRecord = {
 id: string; kind: Kind; author_id: string; site_id: string; shift_id: string;
 payload: string; state: SyncState; created_at: string; received_at: string | null;
 public_number: string | null; error: string | null;
};
export type Duty = {
 post?:string|null; successor_shift_id?:string|null;
 shift_id: string; site_id: string; site_name: string; guard_id: string;
 started_at: string; ended_at: string | null; fetched_at: string;
 presence_status?: 'on_duty' | 'on_break';
 presence_updated_at?: string | null;
};
let dbCache: Promise<SQLite.SQLiteDatabase> | undefined;
const KEY_NAME = 'smartops_db_key_v1';
function randomKeyHex() {
 return Array.from(Crypto.getRandomBytes(32)).map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function db() {
 if (!dbCache) dbCache = (async () => {
   let secret = await SecureStore.getItemAsync(KEY_NAME);
   if (!secret) {
     secret = randomKeyHex();
     await SecureStore.setItemAsync(KEY_NAME, secret);
   }
   const handle = await SQLite.openDatabaseAsync('smartops_encrypted.db');
   // SQLCipher must be built into the native binary. Expo Go is NOT supported.
   await handle.execAsync(`PRAGMA key = "x'${secret}'";`);
   const cipher = await handle.getFirstAsync<{cipher_version:string}>('PRAGMA cipher_version;');
   if (!cipher?.cipher_version) throw new Error('SQLCipher is unavailable. Install an Android development build; Expo Go is unsupported.');
   await handle.execAsync('PRAGMA journal_mode = WAL;');
   await handle.execAsync(`CREATE TABLE IF NOT EXISTS local_records (
      id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, author_id TEXT NOT NULL,
      site_id TEXT NOT NULL, shift_id TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL,
      received_at TEXT, public_number TEXT, error TEXT
   );
   CREATE TABLE IF NOT EXISTS cached_duty (guard_id TEXT PRIMARY KEY NOT NULL,
      shift_id TEXT NOT NULL, site_id TEXT NOT NULL, site_name TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, fetched_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS duty_roster (guard_id TEXT PRIMARY KEY, shift_id TEXT NOT NULL,post TEXT,successor TEXT);
   ${handoverTable};
   CREATE TABLE IF NOT EXISTS incoming_cache (actor TEXT PRIMARY KEY, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS local_photos (
     id TEXT PRIMARY KEY NOT NULL, incident_id TEXT NOT NULL UNIQUE, author_id TEXT NOT NULL,
     uri TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', error TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS linked_incident_local ON local_records(author_id,json_extract(payload,'$.p_source_occurrence_id'))
     WHERE kind='incident' AND json_valid(payload);
   `);
   return handle;
 })().catch(e => { dbCache = undefined; throw e; });
 return dbCache;
}
export async function storeDuty(duty: Duty) {
 const d = await db();
 await d.runAsync('INSERT OR REPLACE INTO duty_roster VALUES(?,?,?,?)',duty.guard_id,duty.shift_id,duty.post??null,duty.successor_shift_id??null);
 await d.runAsync(`INSERT INTO cached_duty(guard_id,shift_id,site_id,site_name,started_at,ended_at,fetched_at)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(guard_id) DO UPDATE SET shift_id=excluded.shift_id,
 site_id=excluded.site_id,site_name=excluded.site_name,started_at=excluded.started_at,
 ended_at=excluded.ended_at,fetched_at=excluded.fetched_at`,
 duty.guard_id,duty.shift_id,duty.site_id,duty.site_name,duty.started_at,duty.ended_at,duty.fetched_at);
}
export async function cachedDuty(guardId: string, mode: 'operational' | 'recovery' = 'operational'): Promise<Duty | null> {
 const d = await db();
 const record = await d.getFirstAsync<{guard_id:string;shift_id:string;site_id:string;site_name:string;started_at:string;ended_at:string|null;fetched_at:string}>(
  'SELECT * FROM cached_duty WHERE guard_id = ?',guardId);
 if (!record) return null;
 const now=Date.now(), verifiedAt=Date.parse(record.fetched_at);
 const expired=record.ended_at!==null && Date.parse(record.ended_at)<=now;
 if (!Number.isFinite(verifiedAt) || (mode==='recovery'
  ? !expired || now-verifiedAt>7*24*60*60*1000
  : expired || now-verifiedAt>12*60*60*1000)) return null;
 const roster=await d.getFirstAsync<{post:string|null;successor_shift_id:string|null}>('SELECT post,successor AS successor_shift_id FROM duty_roster WHERE guard_id=? AND shift_id=?',guardId,record.shift_id);
 if (mode==='recovery'&&!roster) return null;
 return {...record,...roster};
}
export async function queueRecord(kind: Kind, guard: Duty, data: Record<string,string>,photoUri?:string) {
 const d = await db();
 const id = Crypto.randomUUID();
 const savedAt = new Date().toISOString();
 const eventTime = data.eventAt ?? savedAt;
 if (!eventTime || !Number.isFinite(Date.parse(eventTime))) throw new Error('Invalid event time');
 const payload = makeQueuedPayload(kind,id,guard.site_id,guard.shift_id,
  {category:data.category,severity:data.severity,narrative:data.narrative,eventAt:eventTime},savedAt);
 const args=data.sourceOccurrenceId?{...payload,p_source_occurrence_id:data.sourceOccurrenceId}:payload;
 if(photoUri && data.sourceOccurrenceId){
   const existing=await d.getFirstAsync<{id:string}>("SELECT id FROM local_records WHERE author_id=? AND kind='incident' AND json_extract(payload,'$.p_source_occurrence_id')=?",guard.guard_id,data.sourceOccurrenceId);
   if(existing)throw new Error('This occurrence already has a linked incident. Open it to review the existing report.');
 }
 let durableUri:string|undefined;
 const photoId=photoUri?Crypto.randomUUID():undefined;
 if(photoUri&&photoId){
   if(!FileSystem.documentDirectory)throw new Error('Device storage is unavailable');
   const directory=FileSystem.documentDirectory+'incident-evidence/';
   await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
   durableUri=directory+photoId+'.jpg';
   await FileSystem.copyAsync({from:photoUri,to:durableUri});
   const info=await FileSystem.getInfoAsync(durableUri);
   if(!info.exists||!info.size||info.size>6291456){
     await FileSystem.deleteAsync(durableUri,{idempotent:true});
     throw new Error('Photo must be between 1 byte and 6 MB.');
   }
 }
 try {
  await d.withTransactionAsync(async()=>{
   await d.runAsync(`INSERT INTO local_records(id,kind,author_id,site_id,shift_id,payload,state,created_at)
    VALUES(?,?,?,?,?,?,'queued',?) ON CONFLICT DO NOTHING`,id,kind,guard.guard_id,guard.site_id,guard.shift_id,JSON.stringify(args),savedAt);
   if(photoId&&durableUri){
    const inserted=await d.getFirstAsync<{id:string}>('SELECT id FROM local_records WHERE id=?',id);
    if(!inserted)throw new Error('Incident already exists; open it before adding evidence.');
    await d.runAsync('INSERT INTO local_photos(id,incident_id,author_id,uri) VALUES(?,?,?,?)',photoId,id,guard.guard_id,durableUri);
   }
  });
 } catch(error) {
  if(durableUri)await FileSystem.deleteAsync(durableUri,{idempotent:true});
  throw error;
 }
 if(data.sourceOccurrenceId){
   const saved=await d.getFirstAsync<{id:string}>("SELECT id FROM local_records WHERE author_id=? AND kind='incident' AND json_extract(payload,'$.p_source_occurrence_id')=?",guard.guard_id,data.sourceOccurrenceId);
   if(!saved)throw new Error('Linked incident could not be saved');return saved.id;
 }
 return id;
}
export async function listRecords(guardId: string): Promise<LocalRecord[]> {
 const d=await db();
 return d.getAllAsync<LocalRecord>('SELECT * FROM local_records WHERE author_id=? ORDER BY created_at DESC LIMIT 100',guardId);
}
export async function unsentCount(guardId: string) {
 const d=await db();
 const result = await d.getFirstAsync<{count:number}>(
   `SELECT count(*) AS count FROM local_records WHERE author_id=? AND state <> 'received'`,guardId);
 const ops=await d.getFirstAsync<{n:number}>("SELECT count(*) AS n FROM handover_ops WHERE actor=? AND state<>'received'",guardId);
 const photos=await d.getFirstAsync<{n:number}>("SELECT count(*) AS n FROM local_photos WHERE author_id=? AND state<>'uploaded'",guardId);
 return (result?.count ?? 0)+(ops?.n??0)+(photos?.n??0);
}
export async function listPhotos(actor:string){
 const d=await db();
 return d.getAllAsync<{id:string;incident_id:string;state:'queued'|'uploading'|'uploaded'|'failed';error:string|null}>(
  'SELECT id,incident_id,state,error FROM local_photos WHERE author_id=? ORDER BY rowid DESC',actor);
}
export async function listHandoverOps(actor:string){
 const d=await db();
 return d.getAllAsync<{id:string;slot:string;kind:'submit'|'receive';state:SyncState;error:string|null;payload:string}>(
  'SELECT id,slot,kind,state,error,payload FROM handover_ops WHERE actor=? ORDER BY rowid DESC',actor);
}
const inFlightSync = new Map<string, Promise<{sent:number;failed:number}>>();
const syncObservers = new Map<string, Set<()=>Promise<void> | void>>();
export async function syncRecords(guardId:string,onStateChange?:()=>Promise<void> | void,recordId?:string):Promise<{sent:number;failed:number}> {
 if(onStateChange){const listeners=syncObservers.get(guardId)??new Set();listeners.add(onStateChange);syncObservers.set(guardId,listeners);}
 const existing = inFlightSync.get(guardId);
 if (existing) {try{return await existing;}finally{if(onStateChange)syncObservers.get(guardId)?.delete(onStateChange);}}
 const running = runSync(guardId,recordId);
 inFlightSync.set(guardId, running);
 try { return await running; } finally { inFlightSync.delete(guardId);syncObservers.delete(guardId); }
}
export async function syncRecord(guardId:string,recordId:string,onStateChange?:()=>Promise<void>|void){
 return syncRecords(guardId,onStateChange,recordId);
}
async function runSync(guardId:string,recordId?:string):Promise<{sent:number;failed:number}> {
 const d=await db();
 const result=await syncPending(guardId,{
  pending:async id=>recordId
   ? d.getAllAsync<LocalRecord>(`SELECT * FROM local_records WHERE author_id=? AND id=?
      AND state IN ('queued','sending','failed') LIMIT 1`,id,recordId)
   : d.getAllAsync<LocalRecord>(`SELECT * FROM local_records
      WHERE author_id=? AND state IN ('queued','sending','failed') ORDER BY created_at LIMIT 50`,id),
  markSending:async id=>{await d.runAsync(`UPDATE local_records SET state='sending',error=NULL WHERE id=?`,id);},
  submit:async(kind,args)=>{const method=kind==='occurrence'?'submit_ob_entry':args.p_source_occurrence_id?'submit_linked_incident':'submit_incident';
   const {data,error}=await supabase.rpc(method,args);if(error)throw error;return data;},
  markReceived:async(id,receivedAt,publicNumber)=>{await d.runAsync(`UPDATE local_records SET state='received',received_at=?,public_number=?,error=NULL WHERE id=?`,receivedAt,publicNumber,id);},
  markFailed:async(id,error)=>{await d.runAsync(`UPDATE local_records SET state='failed',error=? WHERE id=?`,error,id);},
  onStateChange:async()=>{await Promise.allSettled([...(syncObservers.get(guardId)??[])].map(listener=>listener()));}
 });
 const photoResult=await syncPhotos({
  pending:()=>d.getAllAsync<{id:string;incident_id:string;uri:string}>(
   `SELECT p.id,p.incident_id,p.uri FROM local_photos p JOIN local_records r ON r.id=p.incident_id
    WHERE p.author_id=? AND r.state='received' AND p.state<>'uploaded' AND (? IS NULL OR p.incident_id=?)`,
   guardId,recordId??null,recordId??null),
  uploading:async id=>{await d.runAsync("UPDATE local_photos SET state='uploading',error=NULL WHERE id=?",id);},
  send:async photo=>{
   const info=await FileSystem.getInfoAsync(photo.uri);
   if(!info.exists)throw new Error('The saved photo is missing. Contact your supervisor before removing this report.');
   const {data:path,error:registrationError}=await supabase.rpc('register_incident_photo',{p_id:photo.id,p_incident_id:photo.incident_id});
   if(registrationError)throw new Error(registrationError.message);
   if(path!==photo.incident_id+'/'+photo.id+'.jpg')throw new Error('Invalid photo registration receipt');
   const response=await fetch(photo.uri);
   const bytes=await response.arrayBuffer();
   const {error:uploadError}=await supabase.storage.from('incident-evidence').upload(path,bytes,{contentType:'image/jpeg',upsert:true});
   if(uploadError)throw new Error(uploadError.message);
  },
  uploaded:async id=>{await d.runAsync("UPDATE local_photos SET state='uploaded',error=NULL WHERE id=?",id);},
  failed:async(id,message)=>{await d.runAsync("UPDATE local_photos SET state='failed',error=? WHERE id=?",message,id);},
  notify:async()=>{await Promise.allSettled([...(syncObservers.get(guardId)??[])].map(listener=>listener()));}
 });
 result.sent+=photoResult.sent;result.failed+=photoResult.failed;
 if(!recordId){
  const commands=await replayHandovers(d,guardId,async op=>{
   const args=JSON.parse(op.payload);
   const method=op.kind==='receive'?'receive_guard_handover':args.p_ended_at?'submit_guard_end_duty':'submit_guard_handover';
   const response=await supabase.rpc(method,args);
   if(response.error)throw new Error(response.error.message);
   return response.data;
  });
  result.sent+=commands.sent;result.failed+=commands.failed;
 }
 return result;
}
export async function eraseLocalData(guardId: string) {
 const d=await db();
 await d.withTransactionAsync(async()=>{
  await d.runAsync('DELETE FROM local_records WHERE author_id=? AND state=\'received\'',guardId);
  await d.runAsync('DELETE FROM cached_duty WHERE guard_id=?',guardId);
 });
}
