import type {Duty, LocalRecord} from './offline';
import type {IncidentDraft} from './incident-domain';

export type GuardTab='Today'|'OB'|'Incidents'|'Handover';
export type GuardPage='tabs'|'incidentForm'|'submission'|'queue'|'details';
export type LoadState='loading'|'ready'|'error';

export type ReportIncidentScreenProps={
 duty:Duty|null;
 draft:IncidentDraft;
 eventText:string;
 validationError:string|null;
 saving:boolean;
 onDraftChange:(draft:IncidentDraft)=>void;
 onEventTextChange:(value:string)=>void;
 onSave:()=>void;
 onCancel:()=>void;
};

export type SubmissionStatusScreenProps={
 record:LocalRecord|null;
 onOpenQueue:()=>void;
 onOpenHistory:()=>void;
 onToday:()=>void;
};

export type SyncQueueScreenProps={
 records:LocalRecord[];
 syncing:boolean;
 error:string|null;
 onRetry:()=>void;
 onOpenRecord:(id:string)=>void;
};
