/** Presentation helpers for the existing five Supabase occurrence categories. */
export type ObCategory = 'patrol'|'visitor'|'equipment'|'routine'|'other';
export type ObFieldValues = {
  location: string;
  observation: string;
  visitorName: string;
  visitPurpose: string;
  contact: string;
  vehicle: string;
  checkArea: string;
  result: string;
  notes: string;
};
export const OB_CHOICES: {category:ObCategory;title:string;hint:string;icon:string}[] = [
  {category:'patrol',title:'Patrol',hint:'Log a routine patrol',icon:'shield-checkmark-outline'},
  {category:'visitor',title:'Visitor',hint:'Log a visitor or delivery',icon:'person-outline'},
  {category:'equipment',title:'Equipment Check',hint:'Log a site or equipment inspection',icon:'business-outline'},
  {category:'routine',title:'Routine Duty',hint:'Log another regular duty activity',icon:'document-text-outline'},
  {category:'other',title:'Other',hint:'Record another occurrence',icon:'reader-outline'},
];
export function obTitle(category:string) {return OB_CHOICES.find(c=>c.category===category)?.title ?? 'Occurrence';}
export function emptyObFields():ObFieldValues{return {location:'',observation:'',visitorName:'',visitPurpose:'',contact:'',vehicle:'',checkArea:'',result:'',notes:''};}
const trimmed=(v:string)=>v.trim();
/** Store category-specific information in the existing, immutable p_narrative column. */
export function composeObNarrative(category:ObCategory,f:ObFieldValues):string {
 const lines:string[]=[];
 if(category==='patrol'){
  if(!trimmed(f.location))throw new Error('Enter the patrol location or route.');
  if(!trimmed(f.observation))throw new Error('Describe what you observed.');
  lines.push('Patrol location: '+trimmed(f.location),'Observations: '+trimmed(f.observation));
 } else if(category==='visitor'){
  if(!trimmed(f.visitorName))throw new Error('Enter the visitor name or organization.');
  if(!trimmed(f.visitPurpose))throw new Error('Enter the purpose of the visit.');
  lines.push('Visitor: '+trimmed(f.visitorName),'Purpose: '+trimmed(f.visitPurpose));
  if(trimmed(f.contact))lines.push('Host / contact: '+trimmed(f.contact));
  if(trimmed(f.vehicle))lines.push('Vehicle registration: '+trimmed(f.vehicle));
 } else if(category==='equipment'){
  if(!trimmed(f.checkArea))throw new Error('Enter the area or equipment checked.');
  if(!trimmed(f.result))throw new Error('Describe the inspection result.');
  lines.push('Area / equipment: '+trimmed(f.checkArea),'Inspection result: '+trimmed(f.result));
 } else {
  if(!trimmed(f.observation))throw new Error('Describe the occurrence.');
  lines.push(trimmed(f.observation));
 }
 if(trimmed(f.notes))lines.push('Additional notes: '+trimmed(f.notes));
 const result=lines.join('\n');
 if(result.length>3000)throw new Error('Entry exceeds the 3,000-character server limit.');
 return result;
}

export function obDateKey(iso:string):string {
 const d=new Date(iso);
 if(!Number.isFinite(d.getTime()))return '';
 const pad=(n:number)=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function obTimeKey(iso:string):string {
 const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';
 return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
export type ObRow={id:string;shiftId?:string;linkedIncidentId?:string;category:string;narrative:string;eventAt:string;createdAt:string;receivedAt:string|null;status:'queued'|'sending'|'failed'|'received';error?:string|null;};
export function filterObRows(rows:ObRow[],q:string,filter:'all'|'pending'|'received'|'today',category:'all'|ObCategory,today:string):ObRow[]{
 const normalized=q.trim().toLowerCase();
 return rows.filter(row=>{
  const matchesStatus=filter==='all'||(filter==='today'&&obDateKey(row.eventAt)===today)||
   (filter==='received'&&row.status==='received')||(filter==='pending'&&row.status!=='received');
  return matchesStatus && (category==='all'||row.category===category) &&
   (!normalized||`${row.narrative} ${obTitle(row.category)} ${row.status}`.toLowerCase().includes(normalized));
 }).sort((a,b)=>Date.parse(b.eventAt)-Date.parse(a.eventAt));
}
