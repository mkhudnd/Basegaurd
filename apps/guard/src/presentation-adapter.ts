import type {LocalRecord} from './offline';
import type {ServerIncident,ServerIncidentUpdate} from './guard-service';
import type {ActivitySummaryItem} from './screens/TodaysDutyScreen';
import type {SubmissionRecordSummary} from './screens/SubmissionStatusScreen';
import type {SyncQueueItem} from './screens/SyncQueueScreen';
import type {IncidentListItem} from './screens/IncidentHistoryScreen';
import type {IncidentDetailRecord} from './screens/IncidentDetailsScreen';
import type {DeliveryStatus,IncidentSeverity} from './components';

type Payload={p_category?:string;p_severity?:string;p_description?:string;p_narrative?:string;p_reported_at?:string;p_event_at?:string};
const parsed=(record:LocalRecord):Payload=>{try{return JSON.parse(record.payload) as Payload;}catch{return {};}};
const severity=(value?:string):IncidentSeverity=>
 value==='medium'||value==='high'||value==='critical'?value:'low';
const title=(value?:string)=>value?value.charAt(0).toUpperCase()+value.slice(1):'Report';
const siteFor=(siteId:string,names:Record<string,string>)=>names[siteId]??`Site ${siteId}`;

export function localSubmission(record:LocalRecord,siteNames:Record<string,string>):SubmissionRecordSummary {
 const p=parsed(record);
 return {id:record.id,recordType:record.kind,categoryLabel:title(p.p_category),
  severity:record.kind==='incident'?severity(p.p_severity):undefined,
  description:p.p_description??p.p_narrative??'',eventAt:p.p_reported_at??p.p_event_at??'',
  createdAt:record.created_at,siteName:siteFor(record.site_id,siteNames),deliveryStatus:record.state,
  serverRef:record.state==='received'?record.public_number:null,
  receivedAt:record.state==='received'?record.received_at:null,lastError:record.error};
}

export function localQueueItem(record:LocalRecord,siteNames:Record<string,string>):SyncQueueItem {
 const summary=localSubmission(record,siteNames);
 return {id:summary.id,recordType:summary.recordType,title:summary.categoryLabel,
  description:summary.description,eventAt:summary.eventAt,createdAt:summary.createdAt,
  siteName:summary.siteName,deliveryStatus:summary.deliveryStatus,serverRef:summary.serverRef,
  receivedAt:summary.receivedAt,lastError:summary.lastError};
}

export function incidentHistoryItems(local:LocalRecord[],server:ServerIncident[],siteNames:Record<string,string>):IncidentListItem[] {
 const localIds=new Set(local.filter(r=>r.kind==='incident').map(r=>r.id));
 const localItems=local.filter(r=>r.kind==='incident').map(record=>{
  const p=parsed(record);
  const remote=record.state==='received'?server.find(s=>s.id===record.id):undefined;
  return {id:record.id,categoryLabel:title(p.p_category),severity:severity(p.p_severity),
   description:p.p_description??'',eventAt:p.p_reported_at??'',createdAt:record.created_at,
   siteName:siteFor(record.site_id,siteNames),
   deliveryStatus:(remote?.status&&remote.status!=='reported'?remote.status:record.state) as DeliveryStatus,
   serverRef:record.state==='received'?record.public_number:null,
   receivedAt:record.state==='received'?record.received_at:null};
 });
 const remoteItems=server.filter(item=>!localIds.has(item.id)).map(item=>({
  id:item.id,categoryLabel:title(item.category),severity:severity(item.severity),description:item.description,
  eventAt:item.reported_at,createdAt:'',siteName:siteFor(item.site_id,siteNames),
  deliveryStatus:(item.status==='reported'?'received':item.status) as DeliveryStatus,
  serverRef:item.public_number,receivedAt:item.received_at,
 }));
 return [...localItems,...remoteItems].sort((a,b)=>
  Date.parse(b.createdAt||b.receivedAt||b.eventAt)-Date.parse(a.createdAt||a.receivedAt||a.eventAt));
}

export function activityItems(records:LocalRecord[],siteNames:Record<string,string>):ActivitySummaryItem[] {
 return records.slice(0,3).map(record=>{
  const item=localQueueItem(record,siteNames);
  return {id:item.id,recordType:record.kind,title:item.title,description:item.description,
   eventAt:item.eventAt,siteName:item.siteName,deliveryStatus:item.deliveryStatus,serverRef:item.serverRef};
 });
}

export function incidentDetail(local:LocalRecord|null,remote:ServerIncident|null,
 updates:ServerIncidentUpdate[],siteNames:Record<string,string>):IncidentDetailRecord|null {
 if(!local&&!remote)return null;
 const p=local?parsed(local):null;
 const confirmedLocal=local?.state==='received';
 const verifiedRemote=remote&&(!local||confirmedLocal)?remote:null;
 const acknowledged=updates.find(u=>u.update_type==='acknowledged');
 const closed=[...updates].reverse().find(u=>u.update_type==='closed');
 return {id:(local??remote)!.id,categoryLabel:title(p?.p_category??remote?.category),
  severity:severity(p?.p_severity??remote?.severity),
  description:p?.p_description??remote?.description??'',
  siteName:siteFor((local??remote)!.site_id,siteNames),eventAt:p?.p_reported_at??remote?.reported_at??'',
  createdAt:local?.created_at??'',
  deliveryStatus:(local&&!confirmedLocal?local.state:
   verifiedRemote?.status&&verifiedRemote.status!=='reported'?verifiedRemote.status:'received') as DeliveryStatus,
  serverRef:confirmedLocal?local.public_number:verifiedRemote?.public_number??null,
  receivedAt:confirmedLocal?local.received_at:verifiedRemote?.received_at??null,
  acknowledgmentVerifiedFromServer:Boolean(verifiedRemote),acknowledgedAt:acknowledged?.created_at??null,
  closedAt:closed?.created_at??null,
  updates:verifiedRemote?updates.map(u=>({id:u.id,updateType:u.update_type,note:u.note,createdAt:u.created_at,authorName:u.author_id})):[],
  lastError:local?.error??null};
}
