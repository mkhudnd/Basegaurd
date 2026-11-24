import {createClient} from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type Site = {id:string; name:string; code:string; latitude?:number|null; longitude?:number|null};
export type Incident = {id:string; public_number:string; site_id:string; category:string; severity:string; description:string; status:string; reported_at:string; received_at:string};
export type Occurrence = {id:string; site_id:string; category:string; narrative:string; event_at:string; received_at:string};
export type Shift = {id:string; site_id:string; guard_id:string; started_at:string; ended_at:string|null; status:string; post?:string|null; checked_in_at?:string|null; presence_status?:string|null};
export type Handover = {id:string; site_id:string; notes:string; post?:string|null; equipment?:string|null; incident_ids?:string[]; submitted_at:string; accepted_at:string|null; outgoing_guard_id:string; incoming_guard_id:string|null};
export type Update = {id:string; author_id:string; created_at:string; update_type:string; note:string};
export type Profile = {display_name:string; role:string; is_active:boolean};
export type Feed = {incidents:Incident[]; occurrences:Occurrence[]; shifts:Shift[]; handovers:Handover[]};

export function errorMessage(error:unknown, fallback:string) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}

export async function authorizedWorkspace(userId:string, signal:AbortSignal) {
  const db = client();
  const {data:profile, error} = await db.from('profiles').select('display_name,role,is_active').eq('id',userId).abortSignal(signal).maybeSingle();
  if (error) throw error;
  if (!profile?.is_active || !['supervisor','admin'].includes(profile.role)) {
    throw new Error('This account is not an active supervisor or administrator.');
  }
  function readSites(columns:string) {
    return collect<Site>(async (start,end) => await db.from('sites').select(columns)
      .order('name').order('id').range(start,end).abortSignal(signal));
  }
  let sites:Site[];
  try {
    sites = await readSites('id,name,code,latitude,longitude');
  } catch (error) {
    // Older schemas have no coordinate columns. A permission or network error is still an error.
    if (!(error && typeof error==='object' && 'code' in error && error.code==='42703')) throw error;
    sites = await readSites('id,name,code');
  }
  return {profile:profile as Profile, sites};
}

async function collect<T>(page:(start:number,end:number)=>PromiseLike<{data:unknown;error:unknown}>):Promise<T[]> {
  const size = 250;
  const rows:T[] = [];
  for (let start = 0; ; start += size) {
    const {data,error} = await page(start,start + size - 1);
    if (error) throw error;
    const batch = data as T[] | null;
    if (!batch?.length) return rows;
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

const feeds = {
  incidents: ['incidents','id,public_number,site_id,category,severity,description,status,reported_at,received_at','received_at'],
  occurrences: ['occurrence_entries','id,site_id,category,narrative,event_at,received_at','event_at'],
  shifts: ['shifts','*','started_at'],
  handovers: ['shift_handovers','*','submitted_at'],
} as const;

export function loadRecords<K extends keyof Feed>(kind:K, siteId:string, signal:AbortSignal) {
  const [table, columns, order] = feeds[kind];
  return collect<Feed[K][number]>(async (start,end) => {
    let query = client().from(table).select(columns).order(order,{ascending:false}).order('id').range(start,end).abortSignal(signal);
    if (siteId) query = query.eq('site_id',siteId);
    return await query;
  }) as Promise<Feed[K]>;
}

export function reviewHistory(incidentId:string, signal:AbortSignal) {
  return collect<Update>(async (start,end) => await client().from('incident_updates').select('id,author_id,created_at,update_type,note')
    .eq('incident_id',incidentId).order('created_at').order('id').range(start,end).abortSignal(signal));
}

export async function acknowledgeIncident(id:string):Promise<string> {
  const {data,error} = await client().rpc('acknowledge_incident',{
    p_incident_id:id,p_note:'Reviewed and acknowledged by supervisor',
  });
  if (error) throw error;
  if (data?.id !== id || !['acknowledged','in_progress','resolved','closed'].includes(data?.status)) {
    throw new Error('Invalid supervisor acknowledgement response.');
  }
  return data.status;
}

export async function recordResponse(id:string, updateId:string, action:'progress'|'resolved', note:string) {
  const {data,error} = await client().rpc('record_incident_response',{
    p_incident_id:id,p_update_id:updateId,p_action:action,p_note:note,
  });
  if (error) throw error;
  if (data?.id !== updateId || typeof data.created_at !== 'string' || !Number.isFinite(Date.parse(data.created_at))) {
    throw new Error('Invalid incident response receipt.');
  }
}
