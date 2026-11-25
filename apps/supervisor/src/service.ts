import {createClient} from '@supabase/supabase-js';
import type {ManagedSite, SecurityPost, SitePoint, SiteBoundary} from './site-geography';
import {harareDayRange,safeSearchTerm,validateAcknowledgementReceipt,validateResponseReceipt,type IncidentSort} from './incident-domain';
import {safePersonnelSearch,validatePersonnelPage,type PersonnelPage,type PersonnelRecord,type PersonnelSort} from './personnel-domain';

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

export function listManagedSites(signal: AbortSignal) {
  return collect<ManagedSite>((start, end) =>
    client().rpc('list_managed_sites', {p_site_id: null}).range(start, end).abortSignal(signal));
}

export function listSecurityPosts(siteId: string, signal: AbortSignal) {
  return collect<SecurityPost>((start, end) =>
    client().rpc('list_site_security_posts', {p_site_id: siteId}).range(start, end).abortSignal(signal));
}

async function geographyMutation<T extends {id: string; revision: number}>(
  rpc: string, args: Record<string, unknown>, expectedId?: string, expectedSite?: string,
): Promise<T> {
  const {data, error} = await client().rpc(rpc, args);
  if (error) throw error;
  if (!data || typeof data.id !== 'string' || !Number.isSafeInteger(data.revision) || data.revision < 1
      || (expectedId && expectedId !== data.id) || (expectedSite && expectedSite !== data.site_id)) {
    throw new Error('The server returned an invalid save receipt. Refresh before retrying.');
  }
  return data as T;
}

export const createManagedSite = (code: string, name: string) =>
  geographyMutation<ManagedSite>('create_managed_site', {p_code: code, p_name: name});

export const updateManagedSite = (site: ManagedSite, name: string, active: boolean) =>
  geographyMutation<ManagedSite>('update_managed_site', {
    p_site_id: site.id, p_expected_revision: site.revision, p_name: name, p_is_active: active,
  }, site.id);

export const saveSiteGeography = (site: ManagedSite, details: string, center: SitePoint | null, boundary: SiteBoundary | null) =>
  geographyMutation<ManagedSite>('save_site_geography', {
    p_site_id: site.id, p_expected_revision: site.geography_revision,
    p_details: details, p_center: center, p_boundary: boundary,
  }, site.id);

export function saveSecurityPost(siteId: string, post: SecurityPost | null,
  code: string, name: string, active: boolean, location: SitePoint | null) {
  const fields = {p_site_id: siteId, p_code: code, p_name: name, p_location: location};
  return post ? geographyMutation<SecurityPost>('update_security_post', {
    ...fields, p_post_id: post.id, p_expected_revision: post.revision, p_is_active: active,
  }, post.id, siteId) : geographyMutation<SecurityPost>('create_security_post', fields, undefined, siteId);
}

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
  return Boolean(error&&typeof error==='object'&&'code' in error&&['42P01','42703','42883','PGRST202','PGRST205'].includes(String(error.code)));
}

export const isPersonnelCapabilityUnavailable=missingCapability;

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

export type PersonnelQuery = {
  page:number; pageSize:number; siteId:string; search:string;
  accountStatus:string; dutyStatus:string; sort:PersonnelSort;
};

export async function loadPersonnelPage(filters:PersonnelQuery,allowedSites:Site[],signal:AbortSignal):Promise<PersonnelPage> {
  const {data,error}=await client().rpc('list_site_personnel',{
    p_site_id:filters.siteId||null,
    p_search:safePersonnelSearch(filters.search)||null,
    p_account_status:filters.accountStatus||null,
    p_duty_status:filters.dutyStatus||null,
    p_sort:filters.sort,
    p_offset:Math.max(0,filters.page)*filters.pageSize,
    p_limit:filters.pageSize,
  }).abortSignal(signal);
  if(error)throw error;
  return validatePersonnelPage(data,new Set(allowedSites.map(site=>site.id)),filters.pageSize);
}

export async function loadPersonnelIdentityMap(siteId:string,allowedSites:Site[],signal:AbortSignal) {
  const names:Record<string,string>={};
  const pageSize=100;
  for(let page=0;;page++){
    const result=await loadPersonnelPage({page,pageSize,siteId,search:'',accountStatus:'',dutyStatus:'',sort:'name_asc'},allowedSites,signal);
    for(const row of result.rows)names[row.id]=row.display_name;
    if((page+1)*pageSize>=result.count||!result.rows.length)return names;
  }
}

export type PersonnelHistory = {shifts:Shift[];incidents:Incident[];handovers:Handover[]};

export async function loadPersonnelHistory(person:PersonnelRecord,allowedSites:Site[],signal:AbortSignal):Promise<PersonnelHistory> {
  const permitted=new Set(allowedSites.map(site=>site.id));
  const siteIds=person.site_ids.filter(id=>permitted.has(id));
  if(!siteIds.length)return {shifts:[],incidents:[],handovers:[]};
  const db=client();
  const [shifts,incidents,handovers]=await Promise.all([
    collect<Shift>(async(start,end)=>await db.from('shifts').select('*').eq('guard_id',person.id).in('site_id',siteIds)
      .order('started_at',{ascending:false}).order('id').range(start,end).abortSignal(signal)),
    collect<Incident>(async(start,end)=>await db.from('incidents').select(incidentColumns).eq('reporter_id',person.id).in('site_id',siteIds)
      .order('reported_at',{ascending:false}).order('id').range(start,end).abortSignal(signal)),
    collect<Handover>(async(start,end)=>await db.from('shift_handovers').select('*').in('site_id',siteIds)
      .or(`outgoing_guard_id.eq.${person.id},incoming_guard_id.eq.${person.id}`).order('submitted_at',{ascending:false}).order('id').range(start,end).abortSignal(signal)),
  ]);
  return {shifts,incidents,handovers};
}

export async function inviteGuard(input:{email:string;displayName:string;siteId:string}) {
  const db=client();
  const {data,error}=await db.functions.invoke('invite-guard',{body:{
    email:input.email.trim().toLowerCase(),display_name:input.displayName.trim(),site_id:input.siteId,
  }});
  if(error)throw error;
  const receipt=data as {ok?:unknown;message?:unknown}|null;
  if(receipt?.ok!==true||typeof receipt.message!=='string')throw new Error('Invalid guard invitation response.');
  return receipt.message;
}
