export const incidentStatuses = ['reported','acknowledged','in_progress','resolved','closed'] as const;
export type IncidentStatus = typeof incidentStatuses[number];
export type IncidentSort = 'received_desc'|'received_asc'|'reported_desc'|'reported_asc'|'reference_asc'|'reference_desc';

export const severityRank:Record<string,number> = {critical:4,high:3,medium:2,low:1};

export function displayIncidentStatus(status:string) {
  return status === 'reported' ? 'Needs review' : status.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
}

export function canTransition(from:string, action:'acknowledge'|'progress'|'resolve'|'close') {
  if (action === 'acknowledge') return from === 'reported';
  if (action === 'progress') return from === 'acknowledged' || from === 'in_progress';
  if (action === 'resolve') return from === 'acknowledged' || from === 'in_progress';
  return from === 'resolved';
}

export function safeSearchTerm(value:string) {
  return value.replace(/[(),.%]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
}

export function harareDayRange(day:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(day + 'T00:00:00+02:00');
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start.getTime() + 86_400_000);
  return {start:start.toISOString(),end:end.toISOString()};
}

export function compareSeverity(a:string,b:string) {
  return (severityRank[b]??0)-(severityRank[a]??0);
}

export function validateAcknowledgementReceipt(id:string,data:unknown) {
  const receipt=data as {id?:unknown;status?:unknown}|null;
  if(receipt?.id!==id||!['acknowledged','in_progress','resolved','closed'].includes(String(receipt?.status)))throw new Error('Invalid supervisor acknowledgement response.');
  return String(receipt.status);
}

export function validateResponseReceipt(id:string,data:unknown) {
  const receipt=data as {id?:unknown;created_at?:unknown}|null;
  if(receipt?.id!==id||typeof receipt.created_at!=='string'||!Number.isFinite(Date.parse(receipt.created_at)))throw new Error('Invalid incident response receipt.');
}
