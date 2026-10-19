import {supabase} from './api';
import {cachedDuty, listRecords, queueRecord, storeDuty, syncRecords, type Duty, type LocalRecord} from './offline';
import {buildDescription, parseLocalDateTime, validateIncident, validateOccurrence, type IncidentDraft} from './incident-domain';

export type DutyResult = {duty: Duty | null; source: 'server' | 'cache' | 'none'; error: string | null};

/** A cached assignment permits a local save; the RPC rechecks it at transmission. */
export async function loadDuty(guardId: string): Promise<DutyResult> {
 try {
  const {data,error}=await supabase.from('shifts').select('id,site_id,started_at,ended_at,status')
   .eq('guard_id',guardId).eq('status','active').order('started_at',{ascending:false}).limit(1);
  if(error) throw error;
  const shift=data?.find(s=>Date.parse(s.started_at)<=Date.now()&&(!s.ended_at||Date.parse(s.ended_at)>Date.now()));
  if(!shift) return {duty:null,source:'none',error:null};
  const {data:site,error:siteError}=await supabase.from('sites').select('name').eq('id',shift.site_id).single();
  if(siteError) throw siteError;
  const duty:Duty={guard_id:guardId,shift_id:shift.id,site_id:shift.site_id,site_name:site.name,
   started_at:shift.started_at,ended_at:shift.ended_at,fetched_at:new Date().toISOString()};
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

export async function saveOccurrence(duty:Duty|null,category:string,narrative:string):Promise<string> {
 const error=validateOccurrence(category,narrative,duty);
 if(error)throw new Error(error);
 return queueRecord('occurrence',duty!,{category,narrative:narrative.trim()});
}

export const loadLocalRecords=(guardId:string):Promise<LocalRecord[]>=>listRecords(guardId);
export const retrySync=syncRecords;
