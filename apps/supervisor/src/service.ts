import {createClient} from '@supabase/supabase-js';
import {harareDayRange,safeSearchTerm,validateAcknowledgementReceipt,validateResponseReceipt,type IncidentSort} from './incident-domain';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type Site = {id:string; name:string; code:string; latitude?:number|null; longitude?:number|null};
export type Incident = {
  id:string; public_number:string; site_id:string; shift_id:string; reporter_id:string;
  category:string; severity:string; description:string; status:string;
  reported_at:string; received_at:string; latitude?:number|null; longitude?:number|null;
};
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
export function isAuthError(error:unknown) {
  return Boolean(error&&typeof error==='object'&&(
    ('status' in error&&Number(error.status)===401)||
    ('code' in error&&['PGRST301','refresh_token_not_found','bad_jwt'].includes(String(error.code)))
  ));
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
  incidents: ['incidents','id,public_number,site_id,shift_id,reporter_id,category,severity,description,status,reported_at,received_at','received_at'],
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

export type IncidentQuery = {
  page:number; pageSize:number; siteId:string; severity:string; status:string;
  date:string; search:string; sort:IncidentSort;
};
export type IncidentPage = {rows:Incident[];count:number};
export type IncidentCounts = {all:number;reported:number;acknowledged:number;in_progress:number;resolved:number;closed:number};
export type IncidentEvidence = {id:string;createdAt:string;objectPath:string;signedUrl:string};
export type IncidentContext = {
  post?:string|null; evidence?:IncidentEvidence; evidenceUnavailable?:string;
};

const incidentColumns='id,public_number,site_id,shift_id,reporter_id,category,severity,description,status,reported_at,received_at';
function withIncidentFilters<T>(query:T, filters:Pick<IncidentQuery,'siteId'|'severity'|'status'|'date'|'search'>) {
  let result=query as T & {
    eq:(column:string,value:string)=>typeof result;
    gte:(column:string,value:string)=>typeof result;
    lt:(column:string,value:string)=>typeof result;
    or:(filters:string)=>typeof result;
  };
  if(filters.siteId)result=result.eq('site_id',filters.siteId);
  if(filters.severity)result=result.eq('severity',filters.severity);
  if(filters.status)result=result.eq('status',filters.status);
  const range=harareDayRange(filters.date);
  if(range)result=result.gte('reported_at',range.start).lt('reported_at',range.end);
  const term=safeSearchTerm(filters.search);
  if(term)result=result.or(`public_number.ilike.%${term}%,category.ilike.%${term}%,description.ilike.%${term}%`);
  return result;
}

export async function loadIncidentPage(filters:IncidentQuery,signal:AbortSignal):Promise<IncidentPage> {
  const db=client();
  const from=Math.max(0,filters.page)*filters.pageSize;
  const sorts:Record<IncidentSort,{column:string;ascending:boolean}>={
    received_desc:{column:'received_at',ascending:false},received_asc:{column:'received_at',ascending:true},
    reported_desc:{column:'reported_at',ascending:false},reported_asc:{column:'reported_at',ascending:true},
    reference_asc:{column:'public_number',ascending:true},reference_desc:{column:'public_number',ascending:false},
  };
  const sort=sorts[filters.sort];
  let query=db.from('incidents').select(incidentColumns,{count:'exact'});
  query=withIncidentFilters(query,filters);
  const {data,error,count}=await query.order(sort.column,{ascending:sort.ascending})
    .order('received_at',{ascending:false}).order('id').range(from,from+filters.pageSize-1).abortSignal(signal);
  if(error)throw error;
  return {rows:(data??[]) as Incident[],count:count??0};
}

export async function loadIncidentCounts(siteId:string,signal:AbortSignal):Promise<IncidentCounts> {
  const db=client();
  async function count(status=''){
    let query=db.from('incidents').select('id',{count:'exact',head:true});
    if(siteId)query=query.eq('site_id',siteId);
    if(status)query=query.eq('status',status);
    const result=await query.abortSignal(signal);
    if(result.error)throw result.error;
    return result.count??0;
  }
  const [all,reported,acknowledged,in_progress,resolved,closed]=await Promise.all([
    count(),count('reported'),count('acknowledged'),count('in_progress'),count('resolved'),count('closed'),
  ]);
  return {all,reported,acknowledged,in_progress,resolved,closed};
}

function missingCapability(error:unknown) {
  return Boolean(error&&typeof error==='object'&&'code' in error&&['42P01','42703','PGRST205'].includes(String(error.code)));
}

export async function loadIncidentContext(incident:Incident,signal:AbortSignal):Promise<IncidentContext> {
  const db=client();
  let post:string|null|undefined;
  try{
    const shift=await db.from('shifts').select('post').eq('id',incident.shift_id).abortSignal(signal).maybeSingle();
    if(shift.error)throw shift.error;
    post=shift.data?.post??null;
  }catch(error){if(!missingCapability(error))throw error;}

  try{
    const photo=await db.from('incident_photos').select('id,object_path,created_at').eq('incident_id',incident.id)
      .abortSignal(signal).maybeSingle();
    if(photo.error)throw photo.error;
    if(!photo.data)return {post};
    const signed=await db.storage.from('incident-evidence').createSignedUrl(photo.data.object_path,300);
    if(signed.error)throw signed.error;
    if(!signed.data?.signedUrl)throw new Error('Evidence access returned no signed URL.');
    return {post,evidence:{id:photo.data.id,objectPath:photo.data.object_path,createdAt:photo.data.created_at,signedUrl:signed.data.signedUrl}};
  }catch(error){
    if(isAuthError(error))throw error;
    return {post,evidenceUnavailable:missingCapability(error)?'Evidence storage is not deployed for this project.':errorMessage(error,'Evidence could not be loaded.')};
  }
}

export async function acknowledgeIncident(id:string):Promise<string> {
  const {data,error} = await client().rpc('acknowledge_incident',{
    p_incident_id:id,p_note:'Reviewed and acknowledged by supervisor',
  });
  if (error) throw error;
  return validateAcknowledgementReceipt(id,data);
}

export async function recordResponse(id:string, updateId:string, action:'progress'|'resolved', note:string) {
  const {data,error} = await client().rpc('record_incident_response',{
    p_incident_id:id,p_update_id:updateId,p_action:action,p_note:note,
  });
  if (error) throw error;
  validateResponseReceipt(updateId,data);
}
