import {harareDayRange} from './incident-domain';

export type RosterShift = {
  id: string; site_id: string; guard_id: string; post: string | null; security_post_id: string | null;
  started_at: string; ended_at: string | null; scheduled_start_at: string | null; scheduled_end_at: string | null;
  checked_in_at: string | null; checked_out_at: string | null; successor_shift_id: string | null;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled'; presence_status: string;
  shift_kind: 'day' | 'night' | 'custom' | null; scheduling_revision: number; cancellation_reason: string | null;
  can_reconcile?: boolean;
  protected_successor?: boolean;
  reconciliation?: {actor_id:string;reason:string;reconciled_at:string;late_checkout_received_at:string|null} | null;
};

export type OperationsSchedule = {
  as_of:string;
  today_scheduled:number;
  confirmed_check_ins:number;
  upcoming:number;
  awaiting:number;
  missed:number;
  overdue:number;
  planned_gap_posts:number;
  attendance_gap_posts:number;
  unconfigured_posts:number;
  unknown_attendance_posts:number;
  rows:{id:string;site_id:string;guard_id:string;post:string|null;planned_start:string;
    ended_at:string|null;state:'overdue'|'missed'|'awaiting'|'upcoming'}[];
};
export type Coverage = {
  post_id: string; post_name: string; start_at: string; end_at: string;
  booking_capacity: number | null; capacity_revision: number;
  requirement_id: string | null; requirement_revision: number | null;
  requirement_start_at: string | null; requirement_end_at: string | null;
  required_staffing: number | null; scheduled_personnel: number; confirmed_attendance: number | null;
  planned_gap: number | null; actual_attendance_gap: number | null;
  requirements_configured: boolean; legacy_unmapped: boolean; actual_attendance_available: boolean;
};
export const rosterStates = ['Upcoming','Awaiting check-in','Missed check-in','Active duty','On break',
  'Overdue active duty','Completed','Cancelled'] as const;
export type RosterState = typeof rosterStates[number];
export type RosterView = 'Week' | 'Day' | 'List';

const localFields = new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Harare',year:'numeric',
  month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const localField = (value: string | number) => localFields.format(new Date(value)).replace(' ','T');
export const rosterDay = (value: string | number) => localField(value).slice(0,10);
const localLabel = new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Harare',weekday:'short',day:'numeric',month:'short'});
export const dayLabel = (day: string) => localLabel.format(new Date(day+'T12:00:00+02:00'));
export const clockTime = (value: string) => localField(value).slice(11,16);
export const rosterTime = (value: string) => dayLabel(rosterDay(value))+' · '+clockTime(value);

export function shiftDay(day: string, days: number) {
  const date = new Date(day+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
export function rosterRange(day: string, view: RosterView) {
  const weekday = new Date(day+'T12:00:00Z').getUTCDay();
  const first = view==='Day' ? day : shiftDay(day,-((weekday+6)%7));
  const dates = Array.from({length:view==='Day' ? 1 : 7},(_,index)=>shiftDay(first,index));
  return {dates,start:harareDayRange(first)!.start,end:harareDayRange(dates[dates.length-1])!.end};
}

export function asHarareInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return null;
  const date = new Date(value+'+02:00');
  return Number.isFinite(+date) && localField(+date)===value.slice(0,16) ? date.toISOString() : null;
}

// Preserve backend timestamp precision for untouched fields during edits.
export function editableInstant(value: string, original?: string | null) {
  return original && localField(original)===value ? original : asHarareInstant(value);
}

export function bookingWindow(shift: RosterShift) {
  return {start:shift.scheduled_start_at??shift.started_at,end:shift.scheduled_end_at??shift.ended_at};
}
export function rosterState(shift: RosterShift, now: number): RosterState {
  if (shift.status==='cancelled') return 'Cancelled';
  if (shift.status==='completed') return 'Completed';
  if (shift.status==='active') {
    if (shift.ended_at && Date.parse(shift.ended_at)<=now) return 'Overdue active duty';
    return shift.presence_status==='on_break' ? 'On break' : 'Active duty';
  }
  const {start,end}=bookingWindow(shift);
  if (Date.parse(start)>now) return 'Upcoming';
  if (end ? Date.parse(end)<=now : rosterDay(start)<rosterDay(now)) return 'Missed check-in';
  return 'Awaiting check-in';
}
export function occursOnDay(shift: RosterShift, day: string) {
  const range=harareDayRange(day)!;
  const {start,end}=bookingWindow(shift);
  return Date.parse(start)<Date.parse(range.end) && (end===null || Date.parse(end)>Date.parse(range.start));
}
export function rosterActions(shift: RosterShift, now: number, protectedIncoming: boolean) {
  const unstarted = shift.status==='scheduled' && !shift.checked_in_at && !protectedIncoming;
  return {edit:unstarted && Date.parse(shift.started_at)>now,cancel:unstarted};
}
export function canFollow(candidate:RosterShift, shiftId:string | null, postId:string, guardId:string, end:string) {
  return candidate.id!==shiftId && candidate.security_post_id===postId &&
    candidate.guard_id!==guardId && ['scheduled','active'].includes(candidate.status) &&
    Date.parse(candidate.started_at)>=Date.parse(end);
}
export function coverageValue(row: Coverage, key: keyof Coverage): number | undefined {
  if (key==='confirmed_attendance' && !row.actual_attendance_available) return undefined;
  if (key==='scheduled_personnel' && row.legacy_unmapped) return undefined;
  const value=row[key];
  return typeof value==='number' ? value : undefined;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type RosterReceipt = {id:string;operation_id:string;revision:number;status:string;received_at:string};
export function rosterReceipt(data:unknown, operationId:string, id:string|null, revision:number, status:string): RosterReceipt {
  const receipt=data as Partial<RosterReceipt> | null;
  if (!receipt || receipt.operation_id!==operationId || typeof receipt.id!=='string' || !uuid.test(receipt.id)
      || (id && receipt.id!==id) || receipt.revision!==revision || receipt.status!==status
      || typeof receipt.received_at!=='string' || !Number.isFinite(Date.parse(receipt.received_at))) {
    throw new RosterReceiptError();
  }
  return receipt as RosterReceipt;
}
export class RosterReceiptError extends Error {
  constructor(){super('The save could not be confirmed. Retry unchanged to check the same operation.');}
}
export function requestOperation(ids:Map<string,string>, action:string, request:Record<string,unknown>, makeId=()=>crypto.randomUUID()) {
  const key=JSON.stringify([action,Object.entries(request).sort(([a],[b])=>a.localeCompare(b))]);
  const id=ids.get(key)??makeId();
  ids.set(key,id);
  return {key,id};
}
export const errorCode = (error: unknown) => error && typeof error==='object' && 'code' in error ? String(error.code) : '';
export function rosterError(error: unknown) {
  if (error instanceof RosterReceiptError) return error.message;
  const code=errorCode(error);
  if (code==='PT412') return 'This record changed since you opened it. Reload and review the latest version before saving.';
  if (code==='PT409') {
    const message=error && typeof error==='object' && 'message' in error ? String(error.message) : '';
    if (['Post booking capacity exceeded','Staffing requirements overlap for this post','Conflicting operation ID'].includes(message)) return message+'.';
    return 'Guard is unavailable for this interval.';
  }
  if (code==='PT422') return 'The guard, post, or successor is ineligible for this interval. Review the assignment and post capacity.';
  if (code==='PT423') return 'This change would affect a protected shift, handover, or existing commitment.';
  if (code==='42501') return 'This scheduling record is outside your current site permissions.';
  if (code==='22023') return 'Review the required fields and the scheduling interval.';
  if (code==='PGRST202' || code==='42883') return 'Scheduling is unavailable on this backend.';
  return 'The request could not be confirmed. Check the connection and retry.';
}
