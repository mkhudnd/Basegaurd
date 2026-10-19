import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { supabase } from './api';
import {syncPending} from './sync-engine';
import {makeQueuedPayload} from './incident-domain';

export type Kind = 'occurrence' | 'incident';
export type SyncState = 'queued' | 'sending' | 'failed' | 'received';
export type LocalRecord = {
 id: string; kind: Kind; author_id: string; site_id: string; shift_id: string;
 payload: string; state: SyncState; created_at: string; received_at: string | null;
 public_number: string | null; error: string | null;
};
export type Duty = {
 shift_id: string; site_id: string; site_name: string; guard_id: string;
 started_at: string; ended_at: string | null; fetched_at: string;
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
   `);
   return handle;
 })().catch(e => { dbCache = undefined; throw e; });
 return dbCache;
}
export async function storeDuty(duty: Duty) {
 const d = await db();
 await d.runAsync(`INSERT INTO cached_duty(guard_id,shift_id,site_id,site_name,started_at,ended_at,fetched_at)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(guard_id) DO UPDATE SET shift_id=excluded.shift_id,
 site_id=excluded.site_id,site_name=excluded.site_name,started_at=excluded.started_at,
 ended_at=excluded.ended_at,fetched_at=excluded.fetched_at`,
 duty.guard_id,duty.shift_id,duty.site_id,duty.site_name,duty.started_at,duty.ended_at,duty.fetched_at);
}
export async function cachedDuty(guardId: string): Promise<Duty | null> {
 const d = await db();
 const record = await d.getFirstAsync<{guard_id:string;shift_id:string;site_id:string;site_name:string;started_at:string;ended_at:string|null;fetched_at:string}>(
  'SELECT * FROM cached_duty WHERE guard_id = ?',guardId);
 if (!record || Date.now()-Date.parse(record.fetched_at)>12*60*60*1000) return null;
 if (record.ended_at && Date.parse(record.ended_at)<Date.now()) return null;
 return record;
}
export async function queueRecord(kind: Kind, guard: Duty, data: Record<string,string>) {
 const d = await db();
 const id = Crypto.randomUUID();
 const savedAt = new Date().toISOString();
 const eventTime = kind === 'incident' ? data.eventAt : savedAt;
 if (!eventTime || !Number.isFinite(Date.parse(eventTime))) throw new Error('Invalid event time');
 const payload = makeQueuedPayload(kind,id,guard.site_id,guard.shift_id,
  {category:data.category,severity:data.severity,narrative:data.narrative,eventAt:eventTime},savedAt);
 await d.runAsync(`INSERT INTO local_records(id,kind,author_id,site_id,shift_id,payload,state,created_at)
 VALUES(?,?,?,?,?,?,'queued',?)`,id,kind,guard.guard_id,guard.site_id,guard.shift_id,JSON.stringify(payload),savedAt);
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
 return result?.count ?? 0;
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
 return syncPending(guardId,{
  pending:async id=>recordId
   ? d.getAllAsync<LocalRecord>(`SELECT * FROM local_records WHERE author_id=? AND id=?
      AND state IN ('queued','sending','failed') LIMIT 1`,id,recordId)
   : d.getAllAsync<LocalRecord>(`SELECT * FROM local_records
      WHERE author_id=? AND state IN ('queued','sending','failed') ORDER BY created_at LIMIT 50`,id),
  markSending:async id=>{await d.runAsync(`UPDATE local_records SET state='sending',error=NULL WHERE id=?`,id);},
  submit:async(kind,args)=>{const method=kind==='occurrence'?'submit_ob_entry':'submit_incident';
   const {data,error}=await supabase.rpc(method,args);if(error)throw error;return data;},
  markReceived:async(id,receivedAt,publicNumber)=>{await d.runAsync(`UPDATE local_records SET state='received',received_at=?,public_number=?,error=NULL WHERE id=?`,receivedAt,publicNumber,id);},
  markFailed:async(id,error)=>{await d.runAsync(`UPDATE local_records SET state='failed',error=? WHERE id=?`,error,id);},
  onStateChange:async()=>{await Promise.allSettled([...(syncObservers.get(guardId)??[])].map(listener=>listener()));}
 });
}
export async function eraseLocalData(guardId: string) {
 const d=await db();
 await d.withTransactionAsync(async()=>{
  await d.runAsync('DELETE FROM local_records WHERE author_id=? AND state=\'received\'',guardId);
  await d.runAsync('DELETE FROM cached_duty WHERE guard_id=?',guardId);
 });
}
