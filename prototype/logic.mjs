/** Pure prototype state transitions. Browser localStorage is not a secure production store. */
export const INCIDENT_TYPES = ['Breach / Intrusion','Theft / Loss','Property Damage','Suspicious Person / Vehicle','Fire / Safety Hazard','Other'];
export const SEVERITIES = ['Low','Medium','High','Critical'];
export const OB_TYPES = ['Routine Patrol','Visitor / Delivery','Equipment Check','Observation','Other'];
export function validateIncident(data) {
  const errors = {};
  if (!INCIDENT_TYPES.includes(data.type)) errors.type = 'Choose an incident type.';
  if (!SEVERITIES.includes(data.severity)) errors.severity = 'Choose a severity level.';
  if (!data.description || data.description.trim().length < 20) errors.description = 'Describe what happened in at least 20 characters.';
  if (!data.eventTime || Number.isNaN(Date.parse(data.eventTime))) errors.eventTime = 'Enter a valid time.';
  return errors;
}
export function validateOccurrence(data) {
  const errors = {};
  if (!OB_TYPES.includes(data.category)) errors.category = 'Choose an occurrence type.';
  if (!data.description || data.description.trim().length < 10) errors.description = 'Enter at least 10 characters.';
  return errors;
}
export function createRecord(type, input, id, now) {
  return {id, type, siteId:'demo-site-a', site:'Demonstration Site A', createdBy:'Demo Guard', createdAt:now,
    eventTime:input.eventTime || now, delivery:'queued', serverRef:null, receivedAt:null,
    acknowledgedAt:null, closedAt:null, updates:[], ...input};
}
export function simulateSync(records, now, nextNumber) {
  let number=nextNumber;
  const synced=records.map(r=>{
    if (!['queued','failed'].includes(r.delivery)) return r;
    number++;
    return {...r,delivery:'received',serverRef:`DEMO-${r.type==='incident'?'INC':'OB'}-2026-${String(number).padStart(4,'0')}`,receivedAt:now};
  });
  return {records:synced,nextNumber:number};
}
export function acknowledge(record, now) {
  if (record.type!=='incident' || record.delivery!=='received') throw Error('Only server-received incidents can be acknowledged.');
  return {...record,delivery:'acknowledged',acknowledgedAt:now,updates:[...record.updates,{action:'acknowledged',at:now,by:'Demo Supervisor'}]};
}
export function closeIncident(record, now, note) {
  if (record.type!=='incident' || record.delivery!=='acknowledged') throw Error('Acknowledge the incident first.');
  if (!note || note.trim().length<8) throw Error('Enter a meaningful resolution note (8+ characters).');
  return {...record,delivery:'closed',closedAt:now,updates:[...record.updates,{action:'closed',note:note.trim(),at:now,by:'Demo Supervisor'}]};
}
export function deliveryLabel(delivery){return ({queued:'Pending Sync',failed:'Sync Failed',received:'Received by Server',acknowledged:'Acknowledged',closed:'Closed'})[delivery]||'Unknown';}
