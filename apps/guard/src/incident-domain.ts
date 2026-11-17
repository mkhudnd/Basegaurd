export const incidentCategories = ['theft', 'trespass', 'violence', 'fire', 'medical', 'equipment', 'other'] as const;
export const severities = ['low', 'medium', 'high', 'critical'] as const;
export const occurrenceCategories = ['routine','visitor','patrol','equipment','other'] as const;
export type IncidentDraft = {category: string; severity: string; eventAt: string; narrative: string; actions: string};
export type DutyWindow = {started_at: string; ended_at: string | null; fetched_at: string};
export type RecordState = 'queued' | 'sending' | 'failed' | 'received';

export async function withSubmissionLock<T>(lock:{current:boolean},action:()=>Promise<T>):Promise<T | undefined> {
 if(lock.current) return undefined;
 lock.current=true;
 try{return await action();}finally{lock.current=false;}
}

export function localDateTime(iso: string): string {
 const d = new Date(iso);
 const pad = (n:number) => String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseLocalDateTime(value: string): string | null {
 const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
 if (!match) return null;
 const [, y, mo, day, h, min] = match.map(Number);
 const d = new Date(y,mo-1,day,h,min);
 if (d.getFullYear()!==y || d.getMonth()!==mo-1 || d.getDate()!==day || d.getHours()!==h || d.getMinutes()!==min) return null;
 return d.toISOString();
}

export function validateIncident(draft: IncidentDraft, duty: DutyWindow | null, now = Date.now()): string | null {
 if (!duty || now - Date.parse(duty.fetched_at) > 12 * 60 * 60 * 1000 ||
     (duty.ended_at && Date.parse(duty.ended_at) < now)) return 'Reconfirm your active duty assignment online before saving.';
 if (!incidentCategories.includes(draft.category as typeof incidentCategories[number])) return 'Choose an incident category.';
 if (!severities.includes(draft.severity as typeof severities[number])) return 'Choose a severity.';
 const event = Date.parse(draft.eventAt);
 if (!Number.isFinite(event)) return 'Enter a valid incident date and time.';
 if (event > now + 5 * 60 * 1000 || event < now - 7 * 24 * 60 * 60 * 1000) return 'Incident time must be within the last seven days and no more than five minutes ahead.';
 if (event < Date.parse(duty.started_at) || (duty.ended_at && event > Date.parse(duty.ended_at))) return 'Incident time must fall within your assigned shift.';
 if (draft.narrative.trim().length < 20) return 'Describe what happened in at least 20 characters.';
 if (buildDescription(draft).length > 3000) return 'Narrative and actions must total no more than 3,000 characters.';
 return null;
}

export function buildDescription(draft: IncidentDraft): string {
 const narrative = draft.narrative.trim();
 const actions = draft.actions.trim();
 return actions ? `${narrative}\n\nImmediate actions: ${actions}` : narrative;
}

export function validateOccurrence(category:string,narrative:string,duty:DutyWindow|null,now=Date.now()):string|null {
 if(!duty || now-Date.parse(duty.fetched_at)>12*60*60*1000 ||
  (duty.ended_at && Date.parse(duty.ended_at)<now)) return 'Reconfirm your duty assignment online before saving.';
 if(!occurrenceCategories.includes(category as typeof occurrenceCategories[number])) return 'Choose an OB category.';
 if(narrative.trim().length<5 || narrative.trim().length>3000) return 'Occurrence details must be 5 to 3,000 characters.';
 return null;
}

/** Occurrence event time is distinct from local save time, even when queued offline. */
export function validateOccurrenceEvent(category:string,narrative:string,eventAt:string,duty:DutyWindow|null,now=Date.now()):string|null {
 const basic=validateOccurrence(category,narrative,duty,now);
 if(basic)return basic;
 const event=Date.parse(eventAt);
 if(!Number.isFinite(event))return 'Enter a valid occurrence date and time.';
 if(event>now+5*60*1000 || event<now-7*24*60*60*1000)
   return 'Occurrence time must be within the last seven days and no more than five minutes ahead.';
 if(event<Date.parse(duty!.started_at) || (duty!.ended_at && event>Date.parse(duty!.ended_at)))
   return 'Occurrence time must fall within your assigned shift.';
 return null;
}

export function makeQueuedPayload(kind:'incident'|'occurrence',id:string,siteId:string,shiftId:string,
 data:{category:string;severity?:string;narrative:string;eventAt?:string},savedAt:string):Record<string,string> {
 const base={p_id:id,p_site_id:siteId,p_shift_id:shiftId,p_category:data.category};
 return kind==='incident'
  ? {...base,p_severity:data.severity??'',p_description:data.narrative,p_reported_at:data.eventAt??''}
  : {...base,p_narrative:data.narrative,p_event_at:data.eventAt??savedAt};
}

export function statusLabel(state: RecordState): string {
 switch (state) {
  case 'queued': return 'Saved Locally · Pending Sync';
  case 'sending': return 'Sending · Awaiting Receipt';
  case 'failed': return 'Sync Failed · Saved Locally';
  case 'received': return 'Received by Server';
 }
}

export type Receipt = {id?: unknown; public_number?: unknown; received_at?: unknown};
export function confirmedReceipt(value: unknown, id: string, kind: 'incident' | 'occurrence'):
 {receivedAt: string; publicNumber: string | null} {
 const data = value as Receipt | null;
 if (!data || data.id !== id || typeof data.received_at !== 'string' || !Number.isFinite(Date.parse(data.received_at))) {
  throw new Error('Server receipt missing or invalid');
 }
 if (kind === 'incident' && (typeof data.public_number !== 'string' || !data.public_number.trim())) {
  throw new Error('Incident reference missing from server receipt');
 }
 if (data.public_number != null && typeof data.public_number !== 'string') throw new Error('Invalid server reference');
 return {receivedAt: data.received_at, publicNumber: data.public_number as string | null ?? null};
}
