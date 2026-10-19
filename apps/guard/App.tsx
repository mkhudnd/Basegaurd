import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,BackHandler,Pressable,ScrollView,StatusBar,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import type {Session} from '@supabase/supabase-js';
import {supabase} from './src/api';
import {eraseLocalData,syncRecord,unsentCount,type Duty,type LocalRecord} from './src/offline';
import {localDateTime,occurrenceCategories,withSubmissionLock,type IncidentDraft} from './src/incident-domain';
import {loadDuty,loadGuardName,loadLocalRecords,loadServerHistory,loadServerIncidentDetail,retrySync,
 saveIncidentPayload,saveOccurrence,type DutyResult,type ServerIncident,type ServerIncidentUpdate} from './src/guard-service';
import {activityItems,incidentDetail,incidentHistoryItems,localQueueItem,localSubmission} from './src/presentation-adapter';
import {AppHeader,BottomNavBar,COLORS,FONTS,FormField,InfoAlertBanner,OptionPillGroup,SmartButton,StatusChip,SurfaceCard,formatTimestamp,
 type GuardTabKey} from './src/components';
import {LoginScreen,TodaysDutyScreen,ReportIncidentScreen,SubmissionStatusScreen,SyncQueueScreen,
 IncidentHistoryScreen,IncidentDetailsScreen,type IncidentFormSubmitPayload,type SubmissionRecordSummary,
 type VerifiedShiftContext} from './src/screens';

type Page='tabs'|'incidentForm'|'submission'|'queue'|'details';
type DetailsOrigin='history'|'queue'|'submission';
const categoryLabel=(value:string)=>value?value.charAt(0).toUpperCase()+value.slice(1):'Report';
const recordPayload=(record:LocalRecord):Record<string,string>=>{try{return JSON.parse(record.payload) as Record<string,string>;}catch{return {};}};

function InnerApp(){
 const insets=useSafeAreaInsets();
 const [session,setSession]=useState<Session|null>(null);
 const [authLoading,setAuthLoading]=useState(true);
 const [connection,setConnection]=useState<boolean|null>(null);
 const [busy,setBusy]=useState(false),[syncBusy,setSyncBusy]=useState(false);
 const [message,setMessage]=useState(''),[syncSummary,setSyncSummary]=useState<string|null>(null);
 const [duty,setDuty]=useState<Duty|null>(null),[dutySource,setDutySource]=useState<DutyResult['source']>('none');
 const [dutyError,setDutyError]=useState<string|null>(null),[guardName,setGuardName]=useState<string|null>(null);
 const [records,setRecords]=useState<LocalRecord[]>([]),[serverIncidents,setServerIncidents]=useState<ServerIncident[]>([]);
 const [remoteNames,setRemoteNames]=useState<Record<string,string>>({}),[historyError,setHistoryError]=useState<string|null>(null);
 const [detailServer,setDetailServer]=useState<{incident:ServerIncident;updates:ServerIncidentUpdate[]}|null>(null);
 const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState<string|null>(null);
 const [initialDataLoading,setInitialDataLoading]=useState(false);
 const [tab,setTab]=useState<GuardTabKey>('today'),[page,setPage]=useState<Page>('tabs');
 const [selectedId,setSelectedId]=useState<string|null>(null),[detailsOrigin,setDetailsOrigin]=useState<DetailsOrigin>('history');
 const [queueOrigin,setQueueOrigin]=useState<'tabs'|'submission'>('tabs');
 const [savedFallback,setSavedFallback]=useState<SubmissionRecordSummary|null>(null);
 const [obForm,setObForm]=useState(false),[obCategory,setObCategory]=useState(''),[obNarrative,setObNarrative]=useState('');
 const saving=useRef({current:false}).current,syncing=useRef(false),uidRef=useRef<string|null>(null);
 const uid=session?.user.id??null;
 const isOnline=connection===true;
 const siteNames=useMemo(()=>duty?{...remoteNames,[duty.site_id]:duty.site_name}:remoteNames,[remoteNames,duty]);
 const selectedLocal=records.find(record=>record.id===selectedId)??null;
 const pending=records.filter(record=>record.state!=='received');
 const failedCount=pending.filter(record=>record.state==='failed').length;
 const pendingCount=pending.length-failedCount;

 const refreshLocal=useCallback(async(id:string)=>{
  const next=await loadLocalRecords(id);
  if(uidRef.current===id)setRecords(next);
 },[]);
 const refreshServer=useCallback(async(id:string)=>{
  try{const result=await loadServerHistory(id);
   if(uidRef.current===id){setServerIncidents(result.incidents);setRemoteNames(result.siteNames);setHistoryError(null);}}
  catch(e){if(uidRef.current===id)setHistoryError(e instanceof Error?e.message:'Server history could not be loaded.');}
 },[]);
 const refresh=useCallback(async(id:string)=>{
  setInitialDataLoading(true);
  try{
   const [dutyResult,local]=await Promise.all([loadDuty(id),loadLocalRecords(id)]);
   if(uidRef.current!==id)return;
   setDuty(dutyResult.duty);setDutySource(dutyResult.source);setDutyError(dutyResult.error);
   setRecords(local);
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
 useEffect(()=>{
  const subscription=NetInfo.addEventListener(state=>setConnection(Boolean(state.isConnected&&state.isInternetReachable)));
  void NetInfo.fetch().then(state=>setConnection(Boolean(state.isConnected&&state.isInternetReachable))).catch(()=>setConnection(false));
  return ()=>subscription();
 },[]);
 useEffect(()=>{
  uidRef.current=uid;
  setDuty(null);setDutySource('none');setDutyError(null);setRecords([]);setServerIncidents([]);
  setRemoteNames({});setGuardName(null);setHistoryError(null);setDetailServer(null);setDetailError(null);
  setPage('tabs');setTab('today');setSelectedId(null);setSavedFallback(null);setMessage('');
  if(!uid)return;
  void refresh(uid).catch(e=>setMessage(e instanceof Error?e.message:'Local records could not be loaded.'));
 },[uid,refresh]);
 useEffect(()=>{
  const listener=AppState.addEventListener('change',value=>{
   if(value==='active'&&uid){
    void (async()=>{try{if(isOnline)await retrySync(uid,()=>refreshLocal(uid));await refresh(uid);}
     catch(e){setMessage(e instanceof Error?e.message:'Refresh failed. Local records remain saved.');}})();
   }
  });
  return ()=>listener.remove();
 },[uid,isOnline,refresh,refreshLocal]);

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
  if(obForm){setObForm(false);return true;}
  return false;
 },[page,detailsOrigin,selectedLocal?.kind,queueOrigin,obForm]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',goBack);return ()=>listener.remove();},[goBack]);

 async function login(credentials:{email:string;password:string}){
  if(busy)return;setBusy(true);setMessage('');
  try{const {error}=await supabase.auth.signInWithPassword(credentials);if(error)throw error;}
  catch(e){setMessage(e instanceof Error?e.message:'Sign-in failed');}
  finally{setBusy(false);}
 }
 async function logout(){if(!uid||busy)return;setBusy(true);setMessage('');
  try{const count=await unsentCount(uid);if(count){Alert.alert('Unsent records',`${count} record(s) still need a server receipt. Sync before signing out; local records remain on this phone.`);return;}
   const {error}=await supabase.auth.signOut();if(error)throw error;
   await eraseLocalData(uid);}
  catch(e){setMessage(e instanceof Error?e.message:'Sign-out or local cleanup failed');}
  finally{setBusy(false);}
 }
 function startIncident(){if(!duty){setMessage('Reconfirm an active duty assignment before reporting.');return;}
  setMessage('');setPage('incidentForm');}
 async function saveIncident(payload:IncidentFormSubmitPayload){if(!uid)return;
  await withSubmissionLock(saving,async()=>{setBusy(true);setMessage('');
   try{const draft:IncidentDraft={category:payload.category,severity:payload.severity,eventAt:payload.eventAt,
     narrative:payload.description,actions:payload.actionsTaken??''};
    const id=await saveIncidentPayload(duty,draft);
    setSelectedId(id);setSavedFallback({id,recordType:'incident',categoryLabel:categoryLabel(payload.category),
     severity:payload.severity,description:payload.description,eventAt:payload.eventAt,createdAt:'',
     siteName:duty?.site_name??'Assigned site',deliveryStatus:'queued'});
    setPage('submission');
    try{await refreshLocal(uid);}catch{setMessage(`Saved locally as ${id}; details can be loaded from the queue later.`);}
   }catch(e){setMessage(e instanceof Error?e.message:'Local save failed. Report was not queued.');}
   finally{setBusy(false);}
  });
 }
 async function saveOb(){if(!uid||!duty)return;
  await withSubmissionLock(saving,async()=>{setBusy(true);setMessage('');
   try{const id=await saveOccurrence(duty,obCategory,obNarrative);
    setSelectedId(id);setSavedFallback({id,recordType:'occurrence',categoryLabel:categoryLabel(obCategory),
     description:obNarrative.trim(),eventAt:'',createdAt:'',siteName:duty.site_name,deliveryStatus:'queued'});
    setObForm(false);setObCategory('');setObNarrative('');setPage('submission');
    try{await refreshLocal(uid);}catch{setMessage(`Saved locally as ${id}; details can be loaded from the queue later.`);}
   }catch(e){setMessage(e instanceof Error?e.message:'Local OB save failed.');}
   finally{setBusy(false);}
  });
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
  startedAt:duty.started_at,endedAt:duty.ended_at,status:'active'}:null;
 const localHistory=incidentHistoryItems(records,serverIncidents,siteNames);
 const selectedRemote=detailServer?.incident.id===selectedId?detailServer.incident:null;
 const details=incidentDetail(selectedLocal?.kind==='incident'?selectedLocal:null,selectedRemote,
  detailServer?.updates??[],siteNames);
 const submission=selectedLocal?localSubmission(selectedLocal,siteNames):savedFallback;
 const obRecords=records.filter(record=>record.kind==='occurrence');

 if(authLoading||connection===null||(uid&&uidRef.current!==uid))return <View style={styles.loading}><ActivityIndicator color={COLORS.primary}/></View>;
 return <View style={[styles.root,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
  <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface}/>
  {!session?<LoginScreen onSignIn={login} isLoading={busy} errorMessage={message||null} isOnline={isOnline}/>:<>
   {page==='tabs'&&tab==='today'&&<TodaysDutyScreen shiftContext={shiftContext} isCachedDuty={dutySource==='cache'}
    dutyError={dutyError} notice={message||null} isLoadingShift={initialDataLoading} isOnline={isOnline}
    pendingSyncCount={pendingCount} failedSyncCount={failedCount} recentActivity={activityItems(records,siteNames)}
    activeTab="today" onSelectTab={selectTab} onReportIncident={startIncident}
    onNewOccurrence={()=>{setTab('ob');setObForm(true);setMessage('');}}
    onOpenMyIncidents={()=>selectTab('incidents')} onOpenSyncQueue={openQueue}
    onSelectActivityItem={item=>openDetails(item.id,'history')}
    onRefreshShift={()=>{if(uid)void refresh(uid).catch(e=>setMessage(String(e)));}} onSignOut={()=>void logout()}/>}
   {page==='tabs'&&tab==='incidents'&&<IncidentHistoryScreen incidents={localHistory} canReport={!!duty}
    loadError={historyError} isOnline={isOnline} unsyncedCount={pending.length} activeTab="incidents"
    onSelectTab={selectTab} onSelectIncident={id=>openDetails(id,'history')}
    onReportNewIncident={startIncident} onOpenSyncQueue={openQueue}
    onRefresh={()=>{if(uid)void refreshServer(uid);}}/>}
   {page==='tabs'&&tab==='ob'&&<View style={styles.panel}>
    <AppHeader title="Occurrence Book" subtitle={duty?.site_name??'Local records'} isOnline={isOnline}
     pendingCount={pending.length} onPressSyncBadge={openQueue}/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.panelContent}>
     <Text style={styles.title}>Occurrence Book</Text>
     <Text style={styles.muted}>Routine entries saved on this phone. Server history and corrections are planned.</Text>
     {message?<InfoAlertBanner tone="warning" title="Action Needs Attention" body={message}/>:null}
     {obForm?<SurfaceCard>
      <OptionPillGroup label="Category" required options={occurrenceCategories.map(value=>({value,label:categoryLabel(value)}))}
       selectedValue={obCategory} onSelect={setObCategory}/>
      <FormField label="Occurrence details" required value={obNarrative} onChangeText={setObNarrative} multiline maxLength={3000}/>
      <SmartButton label={busy?'Saving…':'Save on Phone'} onPress={()=>void saveOb()} loading={busy} disabled={!duty||busy}/>
      <SmartButton label="Cancel" variant="ghost" onPress={()=>setObForm(false)}/>
     </SurfaceCard>:<SmartButton label="New OB Entry" onPress={()=>setObForm(true)} disabled={!duty}/>}
     {obRecords.length?obRecords.map(record=>{const p=recordPayload(record);return <Pressable key={record.id}
      accessibilityRole="button" style={styles.obCard} onPress={()=>openDetails(record.id,'history')}>
      <View style={styles.obRow}><Text style={styles.obTitle}>{categoryLabel(p.p_category)}</Text><StatusChip status={record.state}/></View>
      <Text numberOfLines={2} style={styles.body}>{p.p_narrative}</Text>
      <Text style={styles.muted}>Saved {formatTimestamp(record.created_at)}</Text>
     </Pressable>;}):<SurfaceCard><Text style={styles.body}>No local OB entries yet.</Text></SurfaceCard>}
    </ScrollView><BottomNavBar activeTab="ob" onSelectTab={selectTab} unsyncedCount={pending.length}/>
   </View>}
   {page==='tabs'&&tab==='handover'&&<View style={styles.panel}>
    <AppHeader title="Handover" subtitle="Sprint 2" isOnline={isOnline} pendingCount={pending.length} onPressSyncBadge={openQueue}/>
    <ScrollView contentContainerStyle={styles.panelContent}><SurfaceCard>
     <Text style={styles.title}>Planned for Sprint 2</Text>
     <Text style={styles.body}>Use current approved handover procedures. This app cannot submit or accept a handover yet.</Text>
    </SurfaceCard></ScrollView><BottomNavBar activeTab="handover" onSelectTab={selectTab} unsyncedCount={pending.length}/>
   </View>}
   {page==='incidentForm'&&<ReportIncidentScreen siteName={duty?.site_name??'No verified site'}
    shiftStartedAt={duty?.started_at} isOnline={isOnline} pendingCount={pending.length}
    initialEventAt={localDateTime(new Date().toISOString())} isSubmitting={busy} storageError={message||null}
    onSubmitIncident={saveIncident} onCancel={()=>{setPage('tabs');setTab('incidents');}}/>}
   {page==='submission'&&submission&&<SubmissionStatusScreen record={submission} isOnline={isOnline}
    isSyncing={syncBusy} onSyncNow={()=>syncNow()} onOpenSyncQueue={openQueue}
    onOpenDetails={()=>{if(selectedId)openDetails(selectedId,'submission');}}
    onBackToToday={()=>{setTab('today');setPage('tabs');}}/>}
   {page==='queue'&&<SyncQueueScreen items={records.map(record=>localQueueItem(record,siteNames))}
    isOnline={isOnline} isSyncing={syncBusy} lastSyncSummary={syncSummary}
    onSyncAll={()=>syncNow()} onRetryItem={id=>syncNow(id)}
    onSelectItem={item=>openDetails(item.id,'queue')} onBack={()=>goBack()}/>}
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
  </>}
 </View>;
}

export default function App(){return <SafeAreaProvider><InnerApp/></SafeAreaProvider>;}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.background},loading:{flex:1,alignItems:'center',justifyContent:'center'},
 panel:{flex:1,backgroundColor:COLORS.background},panelContent:{padding:16,paddingBottom:28,gap:12},
 title:{fontSize:20,lineHeight:27,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.navy},
 body:{fontSize:15,lineHeight:22,fontFamily:FONTS.regular,color:COLORS.text},
 muted:{fontSize:12,lineHeight:18,fontFamily:FONTS.regular,color:COLORS.textMuted},
 error:{fontSize:13,lineHeight:19,color:COLORS.danger},
 obCard:{backgroundColor:COLORS.surface,borderColor:COLORS.border,borderWidth:1,borderRadius:14,padding:16,gap:8,minHeight:100},
 obRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8},
 obTitle:{fontSize:16,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text},
});
