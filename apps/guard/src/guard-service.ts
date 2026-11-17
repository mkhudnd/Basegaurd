import {supabase} from './api';
import type {DutyPresence} from './duty-presence';
import {cachedDuty, listRecords, queueRecord, storeDuty, syncRecords, type Duty, type LocalRecord} from './offline';
import {buildDescription, parseLocalDateTime, validateIncident, validateOccurrence, validateOccurrenceEvent, type IncidentDraft} from './incident-domain';

export type ServerIncident={
 id:string;public_number:string;site_id:string;category:string;severity:string;description:string;
 reported_at:string;received_at:string;status:'reported'|'acknowledged'|'in_progress'|'resolved'|'closed';
};
export type ServerIncidentUpdate={id:string;update_type:'acknowledged'|'progress'|'resolved'|'closed';note:string;created_at:string};
export type ServerOccurrence={id:string;site_id:string;category:string;narrative:string;event_at:string;received_at:string};
export type ServerHistory={incidents:ServerIncident[];occurrences:ServerOccurrence[];siteNames:Record<string,string>};

export type DutyResult = {duty: Duty | null; source: 'server' | 'cache' | 'none'; error: string | null};

/** A cached assignment permits a local save; the RPC rechecks it at transmission. */
export async function loadDuty(guardId: string): Promise<DutyResult> {
 try {
  const {data,error}=await supabase.from('shifts').select('id,site_id,started_at,ended_at,status,presence_status,presence_updated_at')
   .eq('guard_id',guardId).eq('status','active').order('started_at',{ascending:false}).limit(1);
  if(error) throw error;
  const shift=data?.find(s=>Date.parse(s.started_at)<=Date.now()&&(!s.ended_at||Date.parse(s.ended_at)>Date.now()));
  if(!shift) return {duty:null,source:'none',error:null};
  const {data:site,error:siteError}=await supabase.from('sites').select('name').eq('id',shift.site_id).single();
  if(siteError) throw siteError;
  const duty:Duty={guard_id:guardId,shift_id:shift.id,site_id:shift.site_id,site_name:site.name,
   started_at:shift.started_at,ended_at:shift.ended_at,fetched_at:new Date().toISOString(),
   presence_status:shift.presence_status as DutyPresence,
   presence_updated_at:shift.presence_updated_at??null};
  await storeDuty(duty);
  return {duty,source:'server',error:null};
 } catch(e) {
  const duty=await cachedDuty(guardId);
  return {duty,source:duty?'cache':'none',error:e instanceof Error?e.message:'Duty refresh failed'};
 }
}

export async function saveIncident(duty:Duty|null,draft:IncidentDraft,eventText:string):Promise<string> {
 const eventAt=parseLocalDateTime(eventText);
 const input={...draft,eventAt:eventAt??''};
 const error=validateIncident(input,duty);
 if(error) throw new Error(error);
 return queueRecord('incident',duty!,{category:input.category,severity:input.severity,
  narrative:buildDescription(input),eventAt:input.eventAt});
}

/** Accepts the Gemini form's parsed event ISO while preserving the same domain validator. */
export async function saveIncidentPayload(duty:Duty|null,draft:IncidentDraft):Promise<string> {
 const error=validateIncident(draft,duty);
 if(error)throw new Error(error);
 return queueRecord('incident',duty!,{category:draft.category,severity:draft.severity,
  narrative:buildDescription(draft),eventAt:draft.eventAt});
}

export async function loadGuardName(guardId:string):Promise<string|null> {
 const {data,error}=await supabase.from('profiles').select('display_name').eq('id',guardId).maybeSingle();
 if(error)throw error;
 return data?.display_name??null;
}

export async function loadServerHistory(guardId:string):Promise<ServerHistory> {
 const [reportResult,obResult,siteResult]=await Promise.all([
  supabase.from('incidents').select('id,public_number,site_id,category,severity,description,reported_at,received_at,status')
   .eq('reporter_id',guardId).order('received_at',{ascending:false}).limit(100),
  supabase.from('occurrence_entries').select('id,site_id,category,narrative,event_at,received_at')
   .eq('author_id',guardId).order('event_at',{ascending:false}).limit(100),
  supabase.from('sites').select('id,name'),
 ]);
 if(reportResult.error)throw reportResult.error;
 if(obResult.error)throw obResult.error;
 if(siteResult.error)throw siteResult.error;
 return {incidents:reportResult.data as ServerIncident[]??[],
  occurrences:obResult.data as ServerOccurrence[]??[],
  siteNames:Object.fromEntries((siteResult.data??[]).map(site=>[site.id,site.name]))};
}

export async function loadServerIncidentDetail(guardId:string,id:string):Promise<{incident:ServerIncident;updates:ServerIncidentUpdate[]}|null> {
 const {data,error}=await supabase.from('incidents')
  .select('id,public_number,site_id,category,severity,description,reported_at,received_at,status')
  .eq('id',id).eq('reporter_id',guardId).maybeSingle();
 if(error)throw error;
 if(!data)return null;
 const updates=await supabase.from('incident_updates').select('id,update_type,note,created_at')
  .eq('incident_id',id).order('created_at',{ascending:true});
 if(updates.error)throw updates.error;
 return {incident:data as ServerIncident,updates:updates.data as ServerIncidentUpdate[]??[]};
}

export async function saveOccurrence(duty:Duty|null,category:string,narrative:string,eventAt?:string):Promise<string> {
 const timestamp=eventAt??new Date().toISOString();
 const error=validateOccurrenceEvent(category,narrative,timestamp,duty);
 if(error)throw new Error(error);
 return queueRecord('occurrence',duty!,{category,narrative:narrative.trim(),eventAt:timestamp});
}

export const loadLocalRecords=(guardId:string):Promise<LocalRecord[]>=>listRecords(guardId);
export const retrySync=syncRecords;

/** Authenticated RPC: the server verifies guard identity, site and active shift. */
export type ConfirmedDutyPresence = {status:DutyPresence;updatedAt:string};
export async function setDutyPresence(shiftId: string, presence: DutyPresence): Promise<ConfirmedDutyPresence> {
 const {data,error}=await supabase.rpc('set_duty_presence',{
  p_shift_id:shiftId,p_presence_status:presence,
 });
 if(error)throw error;
 if(data?.presence_status!=='on_duty' && data?.presence_status!=='on_break') {
  throw new Error('Duty status update had no valid server confirmation.');
 }
 if(typeof data.presence_updated_at!=='string' || !Number.isFinite(Date.parse(data.presence_updated_at))) {
  throw new Error('Server did not return a valid duty change timestamp. Refresh your shift.');
 }
 return {status:data.presence_status as DutyPresence,updatedAt:data.presence_updated_at};
}
