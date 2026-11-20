import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,BackHandler,Pressable,ScrollView,StatusBar,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import type {Session} from '@supabase/supabase-js';
import {supabase} from './src/api';
import {canChangeDutyPresence,type DutyPresence} from './src/duty-presence';
import {AuthEntry} from './src/auth/AuthEntry';
import {cachedOfflineRole,roleForProfile,type AccountRole} from './src/auth/role';
import {watchAuthLinks,type AuthFlow} from './src/auth/AuthLinks';
import {SetPasswordScreen} from './src/auth/SetPasswordScreen';
import {SupervisorWorkspace} from './src/SupervisorWorkspace';
import {HandoverPanel} from './src/HandoverPanel';
import {EndDutyScreen} from './src/screens/EndDutyScreen';
import {obDateKey} from './src/occurrence-ui';
import {eraseLocalData,listHandoverOps,listPhotos,syncRecord,unsentCount,type Duty,type LocalRecord} from './src/offline';
import {localDateTime,withSubmissionLock,type IncidentDraft} from './src/incident-domain';
import {loadDuty,loadGuardName,loadLocalRecords,loadServerHistory,loadServerIncidentDetail,retrySync,
 saveIncidentPayload,saveOccurrence,setDutyPresence,type DutyResult,type ServerIncident,type ServerIncidentUpdate,type ServerOccurrence} from './src/guard-service';
import {activityItems,incidentDetail,incidentHistoryItems,localQueueItem,localSubmission} from './src/presentation-adapter';
import type {ObRow} from './src/occurrence-ui';
import {obTitle} from './src/occurrence-ui';
import {AppHeader,BottomNavBar,COLORS,FONTS,FormField,InfoAlertBanner,OptionPillGroup,SmartButton,StatusChip,SurfaceCard,formatTimestamp,
 type GuardTabKey} from './src/components';
import {TodaysDutyScreen,ReportIncidentScreen,SubmissionStatusScreen,SyncQueueScreen,
 IncidentHistoryScreen,IncidentDetailsScreen,OccurrenceBookScreen,type OccurrenceDraft,type IncidentFormSubmitPayload,type SubmissionRecordSummary,
 type VerifiedShiftContext} from './src/screens';

type Page='tabs'|'incidentForm'|'submission'|'queue'|'details'|'endDuty';
type DetailsOrigin='history'|'queue'|'submission';
type RoleState='loading'|'ready'|'error';
const categoryLabel=(value:string)=>value?value.charAt(0).toUpperCase()+value.slice(1):'Report';
const recordPayload=(record:LocalRecord):Record<string,string>=>{try{return JSON.parse(record.payload) as Record<string,string>;}catch{return {};}};

function InnerApp(){
 const insets=useSafeAreaInsets();
 const [session,setSession]=useState<Session|null>(null);
 const [accountRole,setAccountRole]=useState<AccountRole|null>(null);
 const [roleState,setRoleState]=useState<RoleState>('loading');
 const [roleError,setRoleError]=useState('');
 const [roleRetry,setRoleRetry]=useState(0);
 const [authFlow,setAuthFlow]=useState<AuthFlow|null>(null);
 const [authLinkError,setAuthLinkError]=useState('');
 const [authLoading,setAuthLoading]=useState(true);
 const [connection,setConnection]=useState<boolean|null>(null);
 const [busy,setBusy]=useState(false),[syncBusy,setSyncBusy]=useState(false);
 const [presenceBusy,setPresenceBusy]=useState(false);
 const [message,setMessage]=useState(''),[syncSummary,setSyncSummary]=useState<string|null>(null);
 const [duty,setDuty]=useState<Duty|null>(null),[dutySource,setDutySource]=useState<DutyResult['source']>('none');
 const [dutyError,setDutyError]=useState<string|null>(null),[guardName,setGuardName]=useState<string|null>(null);
 const [records,setRecords]=useState<LocalRecord[]>([]),[serverIncidents,setServerIncidents]=useState<ServerIncident[]>([]),[serverOccurrences,setServerOccurrences]=useState<ServerOccurrence[]>([]);
 const [remoteNames,setRemoteNames]=useState<Record<string,string>>({}),[historyError,setHistoryError]=useState<string|null>(null);
 const [detailServer,setDetailServer]=useState<{incident:ServerIncident;updates:ServerIncidentUpdate[]}|null>(null);
 const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState<string|null>(null);
 const [initialDataLoading,setInitialDataLoading]=useState(false);
 const [tab,setTab]=useState<GuardTabKey>('today'),[page,setPage]=useState<Page>('tabs');
 const [selectedId,setSelectedId]=useState<string|null>(null),[detailsOrigin,setDetailsOrigin]=useState<DetailsOrigin>('history');
 const [queueOrigin,setQueueOrigin]=useState<'tabs'|'submission'>('tabs');
 const [savedFallback,setSavedFallback]=useState<SubmissionRecordSummary|null>(null);
 const [obForm,setObForm]=useState(false),[obOpenRequest,setObOpenRequest]=useState(0);
 const [sourceOb,setSourceOb]=useState<ObRow|null>(null);
 const [handoverOps,setHandoverOps]=useState<Awaited<ReturnType<typeof listHandoverOps>>>([]);
 const [photos,setPhotos]=useState<Awaited<ReturnType<typeof listPhotos>>>([]);
 const saving=useRef({current:false}).current,syncing=useRef(false),uidRef=useRef<string|null>(null);
 const uid=session?.user.id??null;
 const isOnline=connection===true;
 const siteNames=useMemo(()=>duty?{...remoteNames,[duty.site_id]:duty.site_name}:remoteNames,[remoteNames,duty]);
 const selectedLocal=records.find(record=>record.id===selectedId)??null;
 const pending=records.filter(record=>record.state!=='received');
 const pendingOps=handoverOps.filter(o=>o.state!=='received');
 const pendingEnd=handoverOps.some(o=>o.kind==='submit'&&o.slot===duty?.shift_id&&o.state!=='received');
 const receivedEnd=handoverOps.some(o=>o.kind==='submit'&&o.slot===duty?.shift_id&&o.state==='received');
 const endDutyRecorded=pendingEnd||receivedEnd;
 const pendingPhotos=photos.filter(p=>p.state!=='uploaded');
 const failedCount=[...pending,...pendingOps,...pendingPhotos].filter(record=>record.state==='failed').length;
 const pendingCount=pending.length+pendingOps.length+pendingPhotos.length-failedCount;

 const refreshLocal=useCallback(async(id:string)=>{
  const [next,ops,photoRows]=await Promise.all([loadLocalRecords(id),listHandoverOps(id),listPhotos(id)]);
  if(uidRef.current===id){setRecords(next);setHandoverOps(ops);setPhotos(photoRows);}
 },[]);
 const refreshServer=useCallback(async(id:string)=>{
  try{const result=await loadServerHistory(id);
   if(uidRef.current===id){setServerIncidents(result.incidents);setServerOccurrences(result.occurrences);setRemoteNames(result.siteNames);setHistoryError(null);}}
  catch(e){if(uidRef.current===id)setHistoryError(e instanceof Error?e.message:'Server history could not be loaded.');}
 },[]);
 const refresh=useCallback(async(id:string)=>{
  setInitialDataLoading(true);
  try{
   const [dutyResult,local,ops,photoRows]=await Promise.all([loadDuty(id),loadLocalRecords(id),listHandoverOps(id),listPhotos(id)]);
   if(uidRef.current!==id)return;
   setDuty(dutyResult.duty);setDutySource(dutyResult.source);setDutyError(dutyResult.error);
   setRecords(local);
   setHandoverOps(ops);
   setPhotos(photoRows);
   const [name]=await Promise.all([loadGuardName(id).catch(()=>null),refreshServer(id)]);
   if(uidRef.current===id)setGuardName(name);
  }finally{if(uidRef.current===id)setInitialDataLoading(false);}
 },[refreshServer]);

 useEffect(()=>{
  const {data:listener}=supabase.auth.onAuthStateChange((_event,current)=>setSession(current));
  supabase.auth.getSession().then(({data})=>setSession(data.session))
   .catch(e=>setMessage(e instanceof Error?e.message:'Session check failed'))
   .finally(()=>setAuthLoading(false));
  return ()=>listener.subscription.unsubscribe();
 },[]);
 useEffect(()=>watchAuthLinks({onFlow:setAuthFlow,onError:setAuthLinkError}),[]);
 useEffect(()=>{
  let mounted=true;
  setAccountRole(null);
  setRoleError('');
  if(!uid){setRoleState('loading');return()=>{mounted=false;};}
  setRoleState('loading');
  void (async()=>{
   try{
    const {data,error}=await supabase.from('profiles').select('role,is_active').eq('id',uid).single();
    if(error)throw error;
    const nextRole=roleForProfile(data);
    if(nextRole==='guard')await SecureStore.setItemAsync(`smartops.lastVerifiedRole.${uid}`,'guard');
    if(mounted){setAccountRole(nextRole);setRoleState('ready');}
   }catch(e){
    // Offline guard mode only for a previously verified guard on this device.
    // This cache never grants server access; Supabase RLS remains authoritative.
    const cached=!isOnline?await SecureStore.getItemAsync(`smartops.lastVerifiedRole.${uid}`).catch(()=>null):null;
    if(!mounted)return;
    if(cachedOfflineRole(isOnline,cached)==='guard'){setAccountRole('guard');setRoleState('ready');}
    else{setRoleError(e instanceof Error?e.message:'Unable to verify your role.');setRoleState('error');}
   }
  })();
  return()=>{mounted=false;};
 },[uid,isOnline,roleRetry]);
 useEffect(()=>{
  const subscription=NetInfo.addEventListener(state=>setConnection(Boolean(state.isConnected&&state.isInternetReachable)));
  void NetInfo.fetch().then(state=>setConnection(Boolean(state.isConnected&&state.isInternetReachable))).catch(()=>setConnection(false));
  return ()=>subscription();
 },[]);
 useEffect(()=>{
  uidRef.current=uid;
  setHandoverOps([]);setPhotos([]);setSourceOb(null);
  setDuty(null);setDutySource('none');setDutyError(null);setRecords([]);setServerIncidents([]);setServerOccurrences([]);
  setRemoteNames({});setGuardName(null);setHistoryError(null);setDetailServer(null);setDetailError(null);
  setPage('tabs');setTab('today');setSelectedId(null);setSavedFallback(null);setMessage('');setPresenceBusy(false);
  if(!uid||accountRole!=='guard')return;
  void refresh(uid).catch(e=>setMessage(e instanceof Error?e.message:'Local records could not be loaded.'));
 },[uid,accountRole,refresh]);
 useEffect(()=>{
  if(!uid||!isOnline||accountRole!=='guard')return;
  let current=true;
  void retrySync(uid).then(async result=>{
   if(current && (result.sent||result.failed))await refresh(uid);
  }).catch(e=>{if(current)setMessage(String(e));});
  return ()=>{current=false;};
 },[uid,isOnline,accountRole,refresh]);
 useEffect(()=>{
  if(page==='endDuty'&&!duty&&!initialDataLoading){
   const unsentEnd=handoverOps.some(o=>o.kind==='submit'&&o.state!=='received');
   setPage('tabs');setTab('today');
   setMessage(unsentEnd?'End duty is saved on this phone and is waiting to sync. Open the sync queue to review it.':'The active assignment is no longer available. Check the sync queue for the end-duty receipt.');
  }
 },[page,duty,initialDataLoading,handoverOps]);
 useEffect(()=>{
  const listener=AppState.addEventListener('change',value=>{
   if(value==='active'&&uid&&accountRole==='guard'){
    void (async()=>{try{if(isOnline)await retrySync(uid,()=>refreshLocal(uid));await refresh(uid);}
     catch(e){setMessage(e instanceof Error?e.message:'Refresh failed. Local records remain saved.');}})();
   }
  });
  return ()=>listener.remove();
 },[uid,isOnline,accountRole,refresh,refreshLocal]);

 const openQueue=useCallback(()=>{setQueueOrigin(page==='submission'?'submission':'tabs');setPage('queue');},[page]);
 const selectTab=useCallback((next:GuardTabKey)=>{setTab(next);setPage('tabs');setObForm(false);setMessage('');},[]);
 const goBack=useCallback(()=>{
  if(page==='details'){
   if(detailsOrigin==='submission')setPage('submission');
   else if(detailsOrigin==='queue')setPage('queue');
   else{setTab(selectedLocal?.kind==='occurrence'?'ob':'incidents');setPage('tabs');}
   return true;
  }
  if(page==='queue'){setPage(queueOrigin==='submission'?'submission':'tabs');return true;}
  if(page==='submission'){setTab('today');setPage('tabs');return true;}
  if(page==='incidentForm'){setTab('incidents');setPage('tabs');return true;}
  if(page==='endDuty'){setTab('today');setPage('tabs');return true;}
  if(obForm){setObForm(false);return true;}
  return false;
 },[page,detailsOrigin,selectedLocal?.kind,queueOrigin,obForm]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',goBack);return ()=>listener.remove();},[goBack]);

 async function logout(){if(!uid||busy)return;setBusy(true);setMessage('');
  try{const count=await unsentCount(uid);if(count){Alert.alert('Unsent records',`${count} record(s) still need a server receipt. Sync before signing out; local records remain on this phone.`);return;}
   const {error}=await supabase.auth.signOut();if(error)throw error;
   await eraseLocalData(uid);}
  catch(e){setMessage(e instanceof Error?e.message:'Sign-out or local cleanup failed');}
  finally{setBusy(false);}
 }
 async function changePresence(next: DutyPresence){
  if(!duty || !canChangeDutyPresence({shiftId:duty.shift_id,isOnline,isCachedDuty:dutySource==='cache',isBusy:presenceBusy})){
    Alert.alert('Duty status unavailable','Connect to the internet and refresh your verified shift before changing duty status.');
    return;
  }
  if(duty.presence_status===next)return;
  setPresenceBusy(true);
  try{
    const confirmed=await setDutyPresence(duty.shift_id,next);
    setDuty(previous=>previous?.shift_id===duty.shift_id?{...previous,presence_status:confirmed.status,presence_updated_at:confirmed.updatedAt}:previous);
    setMessage('');
  }catch(error){
    Alert.alert('Duty status not changed',error instanceof Error?error.message:'The server did not confirm this change.');
  }finally{setPresenceBusy(false);}
 }
 function openOffDutyHandover(){if(duty)setPage('endDuty');}
 function safetyInstructions(){
  Alert.alert('Emergency procedures',
   'Use approved emergency telephone or radio procedures for urgent assistance. Automated SOS reporting is not yet active in SmartOps.');
 }
 function startIncident(){if(!duty||endDutyRecorded){setMessage('An active duty assignment is required before reporting.');return;}
  setSourceOb(null);setMessage('');setPage('incidentForm');}
 async function saveIncident(payload:IncidentFormSubmitPayload){if(!uid)return;
  await withSubmissionLock(saving,async()=>{setBusy(true);setMessage('');
   try{const draft:IncidentDraft={category:payload.category,severity:payload.severity,eventAt:payload.eventAt,
     narrative:payload.description,actions:payload.actionsTaken??''};
    if(sourceOb && sourceOb.shiftId!==duty?.shift_id)throw new Error('The original shift must still be selected.');
    const id=await saveIncidentPayload(duty,sourceOb?{...draft,eventAt:sourceOb.eventAt}:draft,sourceOb?.id,payload.photoUri);
    setSelectedId(id);setSavedFallback({id,recordType:'incident',categoryLabel:categoryLabel(payload.category),
     severity:payload.severity,description:payload.description,eventAt:payload.eventAt,createdAt:'',
     siteName:duty?.site_name??'Assigned site',deliveryStatus:'queued'});
    setPage('submission');
    try{await refreshLocal(uid);}catch{setMessage(`Saved locally as ${id}; details can be loaded from the queue later.`);}
   }catch(e){setMessage(e instanceof Error?e.message:'Local save failed. Report was not queued.');}
   finally{setBusy(false);}
  });
 }
 async function saveOb(draft:OccurrenceDraft,syncImmediately:boolean){
  if(!uid||!duty)throw new Error('Reconfirm an assigned shift before recording an occurrence.');
  let savedId:string|undefined;
  await withSubmissionLock(saving,async()=>{
   setBusy(true);setMessage('');
   try{
    // Always save to encrypted SQLite first; an online failure must not discard the entry.
    const id=await saveOccurrence(duty,draft.category,draft.narrative,draft.eventAt);
    savedId=id;
    setSelectedId(id);setSavedFallback({id,recordType:'occurrence',categoryLabel:obTitle(draft.category),
     description:draft.narrative,eventAt:draft.eventAt,createdAt:new Date().toISOString(),siteName:duty.site_name,deliveryStatus:'queued'});
    setObForm(false);setPage('submission');
    try{await refreshLocal(uid);}catch{setMessage(`Saved locally as ${id}; details can be loaded from the queue later.`);}
    if(syncImmediately&&isOnline){
     setSyncBusy(true);
     try{
      await syncRecord(uid,id,()=>refreshLocal(uid));
      await refreshLocal(uid);
      await refreshServer(uid);
     }catch(e){setMessage(e instanceof Error?e.message:'Saved locally but automatic sync failed.');}
     finally{setSyncBusy(false);}
    }
   }catch(e){throw e;}
   finally{setBusy(false);}
  });
  if(!savedId)throw new Error('Entry is already being saved. Wait and try again.');
 }
 async function syncNow(recordId?:string){if(!uid||syncing.current)return;
  syncing.current=true;setSyncBusy(true);setSyncSummary(null);setMessage('');
  try{const result=recordId?await syncRecord(uid,recordId,()=>refreshLocal(uid)):
    await retrySync(uid,()=>refreshLocal(uid));
   await refreshLocal(uid);
   await refreshServer(uid);
   const summary=`${result.sent} received by server; ${result.failed} failed. Check each record below.`;
   setSyncSummary(summary);
   if(page==='details'&&selectedId===recordId)void refreshDetails(uid,selectedId);
  }catch(e){const error=e instanceof Error?e.message:'Sync failed; local records are retained.';
   setSyncSummary(error);setMessage(error);}
  finally{syncing.current=false;setSyncBusy(false);}
 }
 async function refreshDetails(id:string,incidentId:string){
  setDetailLoading(true);setDetailError(null);
  try{const result=await loadServerIncidentDetail(id,incidentId);
   if(uidRef.current===id){setDetailServer(result);if(!result)setDetailError('Server incident status is unavailable for this account.');}}
  catch(e){if(uidRef.current===id)setDetailError(e instanceof Error?e.message:'Server incident status could not be loaded.');}
  finally{if(uidRef.current===id)setDetailLoading(false);}
 }
 function openDetails(id:string,origin:DetailsOrigin){
  const local=records.find(record=>record.id===id);
  setSelectedId(id);setDetailsOrigin(origin);setDetailServer(null);setDetailError(null);
  setDetailLoading(!local||local.kind==='incident'&&local.state==='received');
  setPage('details');
 }
 useEffect(()=>{
  if(page!=='details'||!selectedId||!uid)return;
  const local=records.find(r=>r.id===selectedId);
  if(local?.kind==='occurrence'||(local&&local.state!=='received'))return;
  void refreshDetails(uid,selectedId);
 },[page,selectedId,uid]);

 const shiftContext:VerifiedShiftContext|null=duty?{
  shiftId:duty.shift_id,siteId:duty.site_id,siteName:duty.site_name,guardName:guardName??'Guard',
  startedAt:duty.started_at,endedAt:duty.ended_at,status:'active',post:duty.post,
  presenceStatus:dutySource==='server'?duty.presence_status??null:null,
  presenceUpdatedAt:dutySource==='server'?duty.presence_updated_at??null:null}:null;
 const localHistory=incidentHistoryItems(records,serverIncidents,siteNames);
 const selectedRemote=detailServer?.incident.id===selectedId?detailServer.incident:null;
 const details=incidentDetail(selectedLocal?.kind==='incident'?selectedLocal:null,selectedRemote,
  detailServer?.updates??[],siteNames);
 const submission=selectedLocal?localSubmission(selectedLocal,siteNames):savedFallback;
 const obRows:ObRow[]=useMemo(()=>{
  const byId=new Map<string,ObRow>();
  for(const remote of serverOccurrences){byId.set(remote.id,{id:remote.id,shiftId:remote.shift_id,category:remote.category,narrative:remote.narrative,
    eventAt:remote.event_at,createdAt:'',receivedAt:remote.received_at,status:'received'});}
  for(const record of records){
   if(record.kind!=='occurrence')continue;
   const p=recordPayload(record);
   // The server receipt takes precedence when a sync succeeded but the local state was not refreshed.
   if(byId.has(record.id)){
    const remote=byId.get(record.id)!;
    byId.set(record.id,{...remote,createdAt:record.created_at});
    continue;
   }
   byId.set(record.id,{id:record.id,shiftId:record.shift_id,category:p.p_category??'other',narrative:p.p_narrative??'',
    eventAt:p.p_event_at??record.created_at,createdAt:record.created_at,receivedAt:record.received_at,
    status:record.state,error:record.error});
  }
  const links=new Map<string,string>();
  for(const r of records){if(r.kind==='incident'){const source=recordPayload(r).p_source_occurrence_id;if(source)links.set(source,r.id);}}
  for(const i of serverIncidents){if(i.source_occurrence_id)links.set(i.source_occurrence_id,i.id);}
  return [...byId.values()].map(row=>({...row,linkedIncidentId:links.get(row.id)}));
 },[records,serverOccurrences,serverIncidents]);

 if(authLoading||connection===null||(session && roleState==='loading' && !authFlow))
  return <View style={styles.loading}><ActivityIndicator color={COLORS.primary}/></View>;
 return <View style={[styles.root,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
  <StatusBar barStyle="light-content" backgroundColor={COLORS.primary}/>
  <View pointerEvents="none" style={[styles.topSafe,{height:insets.top}]}/>
  {authFlow && session ? <SetPasswordScreen flow={authFlow} onComplete={()=>{setAuthFlow(null);setAuthLinkError('');}}/>:
   !session ? <AuthEntry errorFromLink={authLinkError}/>:
   roleState==='error' ? <View style={styles.accessDenied}>
     <Text style={styles.title}>Account access unavailable</Text>
     <Text style={styles.body}>{roleError}</Text>
     <Text style={styles.muted}>Check your connection or contact your supervisor. Existing offline records will not be erased.</Text>
     <SmartButton label="Retry role verification" onPress={()=>setRoleRetry(x=>x+1)}/>
     <SmartButton label="Sign out" variant="secondary" onPress={()=>void supabase.auth.signOut()}/>
   </View>:
   accountRole==='supervisor'||accountRole==='admin' ? <SupervisorWorkspace userId={uid!} onSignOut={async()=>{const {error}=await supabase.auth.signOut();if(error)throw error;}}/>:
   accountRole==='guard' ? <>
   {page==='tabs'&&tab==='today'&&<TodaysDutyScreen guardId={uid!} shiftContext={shiftContext} isCachedDuty={dutySource==='cache'}
    endDutyPending={pendingEnd}
    endDutyReceived={receivedEnd}
    dutyError={dutyError} notice={message||null} isLoadingShift={initialDataLoading} isOnline={isOnline}
    todayCount={obRows.filter(r=>obDateKey(r.eventAt)===obDateKey(new Date().toISOString())).length}
    profileName={guardName} successorAssigned={!!duty?.successor_shift_id}
    openIncidentCount={isOnline&&!historyError&&!initialDataLoading?serverIncidents.filter(i=>i.status!=='resolved'&&i.status!=='closed').length:null}
    pendingSyncCount={pendingCount} failedSyncCount={failedCount}
    latestReceipt={records.reduce<string|null>((latest,r)=>
      r.state==='received' && r.received_at && (!latest || Date.parse(r.received_at)>Date.parse(latest)) ? r.received_at : latest,null)}
    recentActivity={activityItems(records.filter(r=>r.shift_id===shiftContext?.shiftId),siteNames)}
    activeTab="today" onSelectTab={selectTab} onReportIncident={startIncident}
    onNewOccurrence={()=>{if(!endDutyRecorded){setTab('ob');setObOpenRequest(n=>n+1);setMessage('');}}}
    onOpenMyIncidents={()=>selectTab('incidents')} onOpenSyncQueue={openQueue}
    onSelectActivityItem={item=>openDetails(item.id,'history')}
    onRefreshShift={()=>{if(uid)void refresh(uid).catch(e=>setMessage(String(e)));}} onSignOut={()=>void logout()}
    isUpdatingPresence={presenceBusy} onChangePresence={changePresence} onRequestOffDuty={openOffDutyHandover}
    onOpenHandover={()=>selectTab('handover')} onSafetyProcedures={safetyInstructions}/>}
   {page==='tabs'&&tab==='incidents'&&<IncidentHistoryScreen incidents={localHistory} canReport={!!duty&&!endDutyRecorded}
    loadError={historyError} isOnline={isOnline} unsyncedCount={pending.length} activeTab="incidents"
    onSelectTab={selectTab} onSelectIncident={id=>openDetails(id,'history')}
    onReportNewIncident={startIncident} onOpenSyncQueue={openQueue}
    onRefresh={()=>{if(uid)void refreshServer(uid);}}/>}
   {page==='tabs'&&tab==='ob'&&<OccurrenceBookScreen
    rows={obRows} isOnline={isOnline} hasDuty={!!duty&&!endDutyRecorded} dutyStatus={duty?.presence_status==='on_break'?'On Break':'On Duty'}
    pendingCount={pending.length} error={message||historyError} saving={busy} openEntryRequest={obOpenRequest}
    activeShiftId={duty?.shift_id} onReportEntry={row=>{if(row.linkedIncidentId){openDetails(row.linkedIncidentId,'history');return;}setSourceOb(row);setPage('incidentForm');}}
    onSave={saveOb} onSelectTab={selectTab} onOpenSyncQueue={openQueue}
    onOpenDuty={()=>selectTab('today')} onOpenDraftChange={setObForm} onRequestConsumed={()=>setObOpenRequest(0)}
    onRefresh={()=>{if(uid)void refreshServer(uid);}}/>}
   {page==='tabs'&&tab==='handover'&&<View style={styles.panel}>
    <AppHeader title="Handover" subtitle="Prepare for shift change" isOnline={isOnline} pendingCount={pending.length} onPressSyncBadge={openQueue}/>
    <ScrollView contentContainerStyle={styles.panelContent}>
     <HandoverPanel key={uid} actor={uid!} duty={duty} online={isOnline} incidents={serverIncidents} onDelivered={()=>isOnline?refresh(uid!):refreshLocal(uid!)}/>
    </ScrollView><BottomNavBar activeTab="handover" onSelectTab={selectTab} unsyncedCount={pending.length}/>
   </View>}
   {page==='incidentForm'&&<ReportIncidentScreen siteName={duty?.site_name??'No verified site'}
    initialEventAt={sourceOb?.eventAt??new Date().toISOString()} initialNotes={sourceOb?.narrative} post={duty?.post}
    shiftStartedAt={duty?.started_at} isOnline={isOnline} pendingCount={pending.length}
    isSubmitting={busy} storageError={message||null}
    onSubmitIncident={saveIncident} onCancel={()=>{setPage('tabs');setTab('incidents');}}
    onOpenSyncQueue={openQueue}/>}
   {page==='endDuty'&&duty&&<EndDutyScreen actor={uid!} duty={duty} guardName={guardName} online={isOnline}
    records={records} operations={handoverOps} incidents={serverIncidents} onRefresh={()=>isOnline?refresh(uid!):refreshLocal(uid!)}
    onBack={()=>{setTab('today');setPage('tabs');}} onQueue={openQueue}/>}
   {page==='submission'&&submission&&<SubmissionStatusScreen record={submission} isOnline={isOnline}
    isSyncing={syncBusy} onSyncNow={()=>syncNow()} onOpenSyncQueue={openQueue}
    onOpenDetails={()=>{if(selectedId)openDetails(selectedId,'submission');}}
    onBackToToday={()=>{setTab('today');setPage('tabs');}}/>}
   {page==='queue'&&<SyncQueueScreen items={[...records.map(record=>localQueueItem(record,siteNames)),...photos.map(p=>({
    id:p.id,recordType:'incident' as const,title:'Incident photo',description:p.state==='uploaded'?'Photo uploaded':p.state==='uploading'?'Uploading photo':p.state==='failed'?'Photo upload failed':'Photo waiting to upload',
    eventAt:'',createdAt:'',siteName:'Incident evidence',deliveryStatus:(p.state==='uploaded'?'received':p.state==='uploading'?'sending':p.state) as 'received'|'sending'|'queued'|'failed',lastError:p.error})),...handoverOps.map(o=>({
    id:o.id,recordType:'handover' as const,title:o.kind==='submit'?'Shift handover':'Handover acknowledgement',
    description:o.kind==='submit'?String(JSON.parse(o.payload).p_notes):'Incoming guard receipt',eventAt:'',createdAt:'',
    siteName:'Assigned handover',deliveryStatus:o.state,lastError:o.error}))]}
    isOnline={isOnline} isSyncing={syncBusy} lastSyncSummary={syncSummary}
    onSyncAll={()=>syncNow()} onRetryItem={id=>syncNow(handoverOps.some(o=>o.id===id)?undefined:photos.find(p=>p.id===id)?.incident_id??id)}
    onSelectItem={item=>item.recordType==='handover'?selectTab('handover'):openDetails(photos.find(p=>p.id===item.id)?.incident_id??item.id,'queue')} onBack={()=>goBack()}/>}
   {page==='details'&&selectedLocal?.kind==='occurrence'&&<View style={styles.panel}>
    <AppHeader title="Occurrence Details" subtitle={selectedLocal.id} isOnline={isOnline} onBack={()=>goBack()}/>
    <ScrollView contentContainerStyle={styles.panelContent}><SurfaceCard>
     <StatusChip status={selectedLocal.state}/>
     <Text style={styles.title}>{categoryLabel(recordPayload(selectedLocal).p_category)}</Text>
     <Text style={styles.body}>{recordPayload(selectedLocal).p_narrative}</Text>
     <Text style={styles.muted}>Local UUID: {selectedLocal.id}</Text>
     <Text style={styles.muted}>Saved: {formatTimestamp(selectedLocal.created_at)}</Text>
     {selectedLocal.state==='received'?<Text style={styles.muted}>Server received: {formatTimestamp(selectedLocal.received_at)}</Text>:null}
     {selectedLocal.error?<Text style={styles.error}>{selectedLocal.error}</Text>:null}
    </SurfaceCard>
    {selectedLocal.state!=='received'?<SmartButton label="Retry Sync" onPress={()=>void syncNow(selectedLocal.id)} loading={syncBusy}/>:null}
    <SmartButton label="Back" variant="secondary" onPress={()=>goBack()}/>
    </ScrollView>
   </View>}
   {page==='details'&&selectedLocal?.kind!=='occurrence'&&<IncidentDetailsScreen incident={details}
    isLoading={detailLoading} externalError={detailError||message||null} isOnline={isOnline} isSyncing={syncBusy}
    onRetrySync={id=>syncNow(id)} onRefreshServerState={id=>{if(uid)void refreshDetails(uid,id);}}
    onBack={()=>goBack()}/>}
  </>:<View style={styles.loading}><ActivityIndicator color={COLORS.primary}/></View>}
 </View>;
}

export default function App(){return <SafeAreaProvider><InnerApp/></SafeAreaProvider>;}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.background},topSafe:{position:'absolute',top:0,left:0,right:0,backgroundColor:COLORS.primary},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:COLORS.background},
 accessDenied:{flex:1,justifyContent:'center',padding:24,gap:17,backgroundColor:COLORS.background},
 panel:{flex:1,backgroundColor:COLORS.background},panelContent:{padding:16,paddingBottom:28,gap:12},
 title:{fontSize:20,lineHeight:27,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.navy},
 body:{fontSize:15,lineHeight:22,fontFamily:FONTS.regular,color:COLORS.text},
 muted:{fontSize:12,lineHeight:18,fontFamily:FONTS.regular,color:COLORS.textMuted},
 error:{fontSize:13,lineHeight:19,color:COLORS.danger},
 obCard:{backgroundColor:COLORS.surface,borderColor:COLORS.border,borderWidth:1,borderRadius:14,padding:16,gap:8,minHeight:100},
 obRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8},
 obTitle:{fontSize:16,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text},
});
