import {supabase} from './service';
import {rosterReceipt,type Coverage,type OperationsSchedule,type RosterShift} from './roster-domain';

export type EligibleGuard = {id:string;display_name:string};
export type RosterWindow = {start:string;end:string};
export type RosterMutation = 'save_scheduled_shift' | 'cancel_scheduled_shift' |
  'save_post_booking_capacity' | 'save_post_staffing_requirement' | 'reconcile_overdue_duty';

function call(name:string, fields:Record<string,unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase.rpc(name,fields);
}

export async function listRoster(siteId:string, window:RosterWindow, signal:AbortSignal, postId?:string) {
  const rows:RosterShift[]=[];
  let cursor:RosterShift | undefined;
  for (;;) {
    const {data,error}=await call('list_roster',{
      p_site_id:siteId,p_start:window.start,p_end:window.end,p_post_id:postId??null,
      p_after_start:cursor?.started_at??null,p_after_id:cursor?.id??null,p_limit:100,
    }).abortSignal(signal);
    if (error) throw error;
    const page=(data??[]) as RosterShift[];
    rows.push(...page);
    if (page.length<100) return rows;
    const last=page[page.length-1];
    if (last.id===cursor?.id) throw new Error('Invalid roster cursor.');
    cursor=last;
  }
}
export async function getRosterShift(siteId:string,id:string,signal:AbortSignal) {
  const {data,error}=await call('get_roster_shift',{p_site_id:siteId,p_shift_id:id}).abortSignal(signal);
  if (error) throw error;
  return data as RosterShift | null;
}
export async function listEligibleGuards(siteId:string,window:RosterWindow,signal:AbortSignal) {
  const rows:EligibleGuard[]=[];
  let cursor:string | null=null;
  for (;;) {
    const {data,error}=await call('list_eligible_guards',{
      p_site_id:siteId,p_start:window.start,p_end:window.end,p_after:cursor,p_limit:100,
    }).abortSignal(signal);
    if (error) throw error;
    const page=(data??[]) as EligibleGuard[];
    rows.push(...page);
    if (page.length<100) return rows;
    const last=page[page.length-1].id;
    if (last===cursor) throw new Error('Invalid eligible guard cursor.');
    cursor=last;
  }
}
export async function getRosterCoverage(siteId:string,window:RosterWindow,signal:AbortSignal) {
  const rows:Coverage[]=[];
  for (let offset=0;;offset+=250) {
    const {data,error}=await call('get_roster_coverage',{
      p_site_id:siteId,p_start:window.start,p_end:window.end,
    }).range(offset,offset+249).abortSignal(signal);
    if (error) throw error;
    const page=(data??[]) as Coverage[];
    rows.push(...page);
    if (page.length<250) return rows;
  }
}
export async function getOperationsSchedule(siteId:string,signal:AbortSignal) {
  const {data,error}=await call('get_operations_schedule',{p_site_id:siteId}).abortSignal(signal);
  if (error) throw error;
  if (!data || !Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.as_of))) {
    throw new Error('Scheduling snapshot unavailable.');
  }
  return data as OperationsSchedule;
}
export async function saveRosterMutation(action:RosterMutation,fields:Record<string,unknown>,
  operationId:string,expected:{id:string|null;revision:number;status:string}) {
  const {data,error}=await call(action,{...fields,p_operation_id:operationId});
  if (error) throw error;
  return rosterReceipt(data,operationId,expected.id,expected.revision,expected.status);
}
