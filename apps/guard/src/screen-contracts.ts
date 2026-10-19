/** Public presentation contracts after the Gemini UI integration. */
export type {GuardTabKey as GuardTab,DeliveryStatus} from './components';
export type {LoginScreenProps} from './screens/LoginScreen';
export type {TodaysDutyScreenProps,VerifiedShiftContext,ActivitySummaryItem} from './screens/TodaysDutyScreen';
export type {ReportIncidentScreenProps,IncidentFormSubmitPayload} from './ReportIncidentScreen';
export type {SubmissionStatusScreenProps,SubmissionRecordSummary} from './screens/SubmissionStatusScreen';
export type {SyncQueueScreenProps,SyncQueueItem} from './screens/SyncQueueScreen';
export type {IncidentHistoryScreenProps,IncidentListItem} from './screens/IncidentHistoryScreen';
export type {IncidentDetailsScreenProps,IncidentDetailRecord} from './screens/IncidentDetailsScreen';
export type LoadState='loading'|'ready'|'error';
