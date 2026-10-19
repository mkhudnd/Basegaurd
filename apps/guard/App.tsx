import React, {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,BackHandler,KeyboardAvoidingView,Platform,Pressable,ScrollView,StatusBar,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import {type Session} from '@supabase/supabase-js';
import {supabase} from './src/api';
import {eraseLocalData,unsentCount,type Duty,type LocalRecord} from './src/offline';
import {localDateTime,occurrenceCategories,statusLabel,withSubmissionLock,type IncidentDraft} from './src/incident-domain';
import {loadDuty,loadLocalRecords,retrySync,saveIncident as saveIncidentToOutbox,saveOccurrence,type DutyResult} from './src/guard-service';
import {ReportIncidentScreen} from './src/ReportIncidentScreen';
import type {GuardPage as Page,GuardTab as Tab} from './src/screen-contracts';
import {Button,Card,ChoiceGroup,colors,ConnectionIndicator,Field,StatusChip,typography} from './src/components';

const newDraft=():IncidentDraft=>({category:'',severity:'',eventAt:new Date().toISOString(),narrative:'',actions:''});
const stamp=(value:string|null)=>value?new Date(value).toLocaleString():'—';
function payload(item:LocalRecord):Record<string,string>{try{return JSON.parse(item.payload);}catch{return {};}}
function InnerApp(){
 const insets=useSafeAreaInsets();
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState('');
 const [duty,setDuty]=useState<Duty|null>(null),[records,setRecords]=useState<LocalRecord[]>([]);
 const [dutySource,setDutySource]=useState<DutyResult['source']>('none');
 const [tab,setTab]=useState<Tab>('Today'),[page,setPage]=useState<Page>('tabs'),[selectedId,setSelectedId]=useState<string|null>(null);
 const [detailsOrigin,setDetailsOrigin]=useState<'queue'|'history'>('history');
 const [draft,setDraft]=useState<IncidentDraft>(newDraft),[eventText,setEventText]=useState(localDateTime(new Date().toISOString()));
 const [obCategory,setObCategory]=useState(''),[obNarrative,setObNarrative]=useState(''),[obForm,setObForm]=useState(false);
 const [initialDataLoading,setInitialDataLoading]=useState(false);
 const saving=useRef(false),syncing=useRef(false);
 const uid=session?.user.id;
 const selected=records.find(r=>r.id===selectedId);
 const pending=records.filter(r=>r.state!=='received').length;
 const refresh=useCallback(async(id:string)=>{
  setInitialDataLoading(true);
  try {
   const result=await loadDuty(id);
   setDuty(result.duty);setDutySource(result.source);
   if(result.error)setMessage(`Duty refresh unavailable: ${result.error}`);
   setRecords(await loadLocalRecords(id));
  } finally {setInitialDataLoading(false);}
 },[]);
 useEffect(()=>{
  const {data:sub}=supabase.auth.onAuthStateChange((_event,current)=>setSession(current));
  supabase.auth.getSession().then(({data})=>setSession(data.session)).catch(e=>setMessage(String(e))).finally(()=>setLoading(false));
  return ()=>sub.subscription.unsubscribe();
 },[]);
 useEffect(()=>{if(!uid){setDuty(null);setDutySource('none');setRecords([]);setPage('tabs');return;}refresh(uid).catch(e=>setMessage(String(e)));},[uid,refresh]);
 useEffect(()=>{
  const listener=AppState.addEventListener('change',value=>{if(value==='active'&&uid){void retrySync(uid).then(()=>refresh(uid)).catch(e=>setMessage(String(e)));}});
  return ()=>listener.remove();
 },[uid,refresh]);
 const goBack=useCallback(()=>{if(page==='details'){setPage(detailsOrigin==='queue'?'queue':'tabs');return true;}
  if(page==='queue'||page==='submission'||page==='incidentForm'){setPage('tabs');return true;}
  if(obForm){setObForm(false);return true;}return false;},[page,detailsOrigin,obForm]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',goBack);return ()=>listener.remove();},[goBack]);
 async function login(){if(busy)return;setBusy(true);setMessage('');
  try{const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
  catch(e){setMessage(e instanceof Error?e.message:'Sign-in failed');}finally{setBusy(false);}
 }
 async function logout(){if(!uid)return;
  try{const count=await unsentCount(uid);if(count){Alert.alert('Unsent records',`${count} record(s) still need server receipt. Sync before signing out; local records remain on this phone.`);return;}
   const {error}=await supabase.auth.signOut();if(error)throw error;
   await eraseLocalData(uid);setMessage('');}
  catch(e){setMessage(e instanceof Error?e.message:'Sign-out failed');}
 }
 function startIncident(){setDraft(newDraft());setEventText(localDateTime(new Date().toISOString()));setMessage('');setTab('Incidents');setPage('incidentForm');}
 async function saveIncident(){if(!uid)return;
  await withSubmissionLock(saving,async()=>{setBusy(true);setMessage('');
  try{const id=await saveIncidentToOutbox(duty,draft,eventText);
   setSelectedId(id);setPage('submission');setDraft(newDraft());
   try{setRecords(await loadLocalRecords(uid));}
   catch{setMessage(`Saved locally as ${id}. Refresh the queue to load its details.`);}}
  catch(e){setMessage(e instanceof Error?e.message:'Local save failed. Report was not queued.');}
  finally{setBusy(false);}});
 }
 async function saveOb(){if(!uid||!duty)return;
  await withSubmissionLock(saving,async()=>{setBusy(true);setMessage('');
  try{const id=await saveOccurrence(duty,obCategory,obNarrative);
   setSelectedId(id);setObForm(false);setPage('submission');setObCategory('');setObNarrative('');
   try{setRecords(await loadLocalRecords(uid));}
   catch{setMessage(`Saved locally as ${id}. Refresh the queue to load its details.`);}}
  catch(e){setMessage(e instanceof Error?e.message:'Local save failed.');}
  finally{setBusy(false);}});
 }
 async function syncNow(){if(!uid||syncing.current)return;syncing.current=true;setBusy(true);setMessage('');
  try{const result=await retrySync(uid,async()=>setRecords(await loadLocalRecords(uid)));setRecords(await loadLocalRecords(uid));setMessage(`${result.sent} received by server; ${result.failed} failed. Check each record below.`);}
  catch(e){setMessage(e instanceof Error?e.message:'Sync failed; local records are retained.');}
  finally{syncing.current=false;setBusy(false);}
 }
 const list=records.filter(r=>tab==='OB'?r.kind==='occurrence':r.kind==='incident');
 const recordCard=(item:LocalRecord)=><Pressable key={item.id} accessibilityRole="button" onPress={()=>{setSelectedId(item.id);setDetailsOrigin('history');setPage('details');}} style={styles.record}>
  <View style={styles.row}><Text style={[typography.heading,{flex:1}]}>{(payload(item).p_category||'Report').replace(/^./,x=>x.toUpperCase())}</Text><StatusChip state={item.state}/></View>
  {item.kind==='incident'&&<Text style={typography.muted}>Severity: {payload(item).p_severity}</Text>}
  <Text numberOfLines={2} style={typography.body}>{payload(item).p_description||payload(item).p_narrative}</Text>
  <Text style={typography.muted}>Saved {stamp(item.created_at)} · {item.public_number||item.id}</Text>
 </Pressable>;
 if(loading)return <View style={styles.center}><ActivityIndicator color={colors.green}/></View>;
 return <View style={[styles.root,{paddingTop:insets.top,paddingBottom:insets.bottom}]}><StatusBar barStyle="dark-content" backgroundColor={colors.white}/>
  {!session?<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.login}>
   <Card><Text style={styles.brand}>BASEGUARD · SMARTOPS</Text><Text style={typography.title}>Guard sign in</Text>
    <Text style={typography.muted}>Security reporting · company provisioned accounts</Text></Card>
   <Card><Text style={typography.heading}>Officer verification</Text>
    <Text style={typography.muted}>Use your provisioned account. Internet is required for first sign in.</Text>
    <Field label="Email address" value={email} onChange={setEmail} keyboardType="email-address"/>
    <Field label="Password" value={password} onChange={setPassword} secure/>
    <Button label={busy?'Signing in…':'Sign in'} onPress={login} disabled={busy}/>
    {!!message&&<Text style={typography.error}>{message}</Text>}</Card>
  </ScrollView>:<>
   <View style={styles.header}><View style={{flex:1}}><Text style={styles.brand}>BASEGUARD · SMARTOPS</Text><Text style={typography.muted} numberOfLines={1}>{duty?.site_name||'Guard portal'}</Text></View>
    <ConnectionIndicator pending={pending} onPress={()=>setPage('queue')}/></View>
   <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
   <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    {page!=='tabs'&&<Pressable accessibilityRole="button" onPress={goBack} style={styles.back}><Text style={styles.backText}>‹ Back</Text></Pressable>}
    {page==='tabs'&&tab==='Today'&&<>
     <Text style={typography.title}>Today's Duty</Text>
     {initialDataLoading?<ActivityIndicator color={colors.green}/>:duty?<Card><Text style={typography.heading}>{duty.site_name}</Text><Text style={typography.body}>Active shift · Started {stamp(duty.started_at)}</Text>
       <Text style={typography.muted}>{dutySource==='cache'?'Using a previously verified assignment while offline.':'Assignment checked '+stamp(duty.fetched_at)+'.'} Server validates site and shift at sync.</Text></Card>
      :<Card><Text style={typography.heading}>No verified active assignment</Text><Text style={typography.body}>Reconnect to refresh your shift before recording a report.</Text></Card>}
     {pending>0&&<View style={styles.pending}><Text style={typography.heading}>{pending} awaiting server receipt</Text><Text style={typography.body}>Locally saved reports are not yet visible to supervisors.</Text></View>}
     <Text style={typography.heading}>Quick actions</Text>
     <Button label="Report Incident" onPress={startIncident} disabled={!duty}/>
     <Button label="Sync Queue" onPress={()=>setPage('queue')} variant="secondary"/>
     <Button label="Incident History" onPress={()=>setTab('Incidents')} variant="secondary"/>
     <Text style={typography.muted}>Urgent situations require approved telephone or radio procedures. In-app reporting does not dispatch assistance.</Text>
     <Button label="Sign out" onPress={logout} variant="secondary"/>
    </>}
    {page==='tabs'&&tab==='Incidents'&&<>
     <Text style={typography.title}>Incident History</Text><Text style={typography.muted}>Reports saved on this phone, including those awaiting sync.</Text>
     <Button label="Report Incident" onPress={startIncident} disabled={!duty}/>
     {list.length?list.map(recordCard):<Card><Text style={typography.body}>No local incident reports yet.</Text></Card>}
    </>}
    {page==='tabs'&&tab==='OB'&&<>
     <Text style={typography.title}>Occurrence Book</Text><Text style={typography.muted}>Routine entries saved on this phone.</Text>
     {!obForm?<Button label="New OB Entry" onPress={()=>{setMessage('');setObForm(true);}} disabled={!duty}/>:<>
      <ChoiceGroup label="Category" options={occurrenceCategories} value={obCategory} onChange={setObCategory}/>
      <Field label="Occurrence details" value={obNarrative} onChange={setObNarrative} multiline/>
      <Button label={busy?'Saving…':'Save on phone'} onPress={saveOb} disabled={busy}/>
      <Button label="Cancel" onPress={()=>setObForm(false)} variant="secondary"/>
     </>}
     {list.length?list.map(recordCard):<Card><Text style={typography.body}>No local entries yet.</Text></Card>}
    </>}
    {page==='tabs'&&tab==='Handover'&&<><Text style={typography.title}>Handover</Text><Card><Text style={typography.heading}>Planned for Sprint 2</Text>
     <Text style={typography.body}>Use current approved handover procedures. This app cannot submit or accept a handover yet.</Text></Card></>}
    {page==='incidentForm'&&<ReportIncidentScreen duty={duty} draft={draft} eventText={eventText}
     validationError={message||null} saving={busy} onDraftChange={setDraft} onEventTextChange={setEventText}
     onSave={()=>void saveIncident()} onCancel={()=>setPage('tabs')}/>}
    {page==='submission'&&<>
     <Text style={typography.title}>Submission Status</Text>
     {selected?<><View style={selected.state==='received'?styles.received:styles.pending}><StatusChip state={selected.state}/>
       <Text style={typography.heading}>{statusLabel(selected.state)}</Text>
       <Text style={typography.body}>{selected.state==='received'?'A valid server receipt was recorded. Supervisor acknowledgement is separate.':'This report remains on your phone until server receipt is confirmed.'}</Text></View>
       <Card><Text selectable style={typography.body}>Local ID: {selected.id}</Text><Text style={typography.muted}>Saved {stamp(selected.created_at)}</Text>
       {selected.state==='received'&&<Text selectable style={typography.body}>Server reference: {selected.public_number||'—'}</Text>}
       {!!selected.error&&<Text style={typography.error}>{selected.error}</Text>}</Card></>:<Card><Text style={typography.body}>{selectedId?`Saved locally as ${selectedId}; details are temporarily unavailable. No server receipt has been confirmed.`:'Record unavailable on this phone.'}</Text></Card>}
     <Button label="View Sync Queue" onPress={()=>setPage('queue')}/><Button label="Incident History" onPress={()=>{setTab('Incidents');setPage('tabs');}} variant="secondary"/>
     <Button label="Back to Today" onPress={()=>{setTab('Today');setPage('tabs');}} variant="secondary"/>
    </>}
    {page==='queue'&&<>
     <Text style={typography.title}>Sync Queue</Text><Text style={typography.muted}>Records stored on this phone. Network availability and server permissions are checked during sync.</Text>
     <View style={styles.pending}><Text style={typography.heading}>{pending} awaiting receipt · {records.filter(r=>r.state==='received').length} received</Text>
      <Text style={typography.body}>A failed attempt remains saved. Retry uses the same local UUID.</Text></View>
     <Button label={busy?'Synchronizing…':'Sync now / Retry failed'} onPress={syncNow} disabled={busy||pending===0}/>
     {records.length?records.map(item=><View key={item.id} style={styles.record}><View style={styles.row}><Text style={[typography.heading,{flex:1}]}>{item.kind==='incident'?'Incident':'OB entry'} · {payload(item).p_category}</Text><StatusChip state={item.state}/></View>
      <Text style={typography.muted}>Saved {stamp(item.created_at)}</Text><Text selectable style={typography.muted}>{item.id}</Text>
      {!!item.error&&<Text style={typography.error}>{item.error}</Text>}
      <Button label="View local record" onPress={()=>{setSelectedId(item.id);setDetailsOrigin('queue');setPage('details');}} variant="secondary"/>
     </View>):<Card><Text style={typography.body}>No local records yet.</Text></Card>}
    </>}
    {page==='details'&&<>
     <Text style={typography.title}>{selected?.kind==='occurrence'?'Occurrence Details':'Incident Details'}</Text>
     {selected?<><Card><View style={styles.row}><StatusChip state={selected.state}/>{selected.kind==='incident'&&<Text style={typography.muted}>{payload(selected).p_severity} severity</Text>}</View>
       <Text style={typography.heading}>{payload(selected).p_category}</Text>
       <Text style={typography.body}>{payload(selected).p_description||payload(selected).p_narrative}</Text>
       <Text style={typography.muted}>Event: {stamp(payload(selected).p_reported_at||payload(selected).p_event_at)}</Text>
       <Text style={typography.muted}>Saved on phone: {stamp(selected.created_at)}</Text>
       <Text selectable style={typography.muted}>Local ID: {selected.id}</Text>
       {selected.state==='received'&&<><Text style={typography.muted}>Server received: {stamp(selected.received_at)}</Text>
        {!!selected.public_number&&<Text selectable style={typography.body}>Server reference: {selected.public_number}</Text>}</>}
       {!!selected.error&&<Text style={typography.error}>{selected.error}</Text>}</Card>
       {selected.kind==='incident'&&<Card><Text style={typography.heading}>Supervisor follow-up</Text><Text style={typography.body}>Acknowledgment unavailable. No server status has been fetched.</Text></Card>}
       {selected.state!=='received'&&<Button label="Open Sync Queue" onPress={()=>setPage('queue')}/>}
      </>:<Card><Text style={typography.body}>Record unavailable on this phone.</Text></Card>}
     <Button label="Back to History" onPress={()=>{setTab(selected?.kind==='occurrence'?'OB':'Incidents');setPage('tabs');}} variant="secondary"/>
    </>}
    {!!message&&page!=='incidentForm'&&<View style={styles.notice}><Text style={typography.error}>{message}</Text></View>}
   </ScrollView></KeyboardAvoidingView>
   {page==='tabs'&&<View style={styles.nav}>{(['Today','OB','Incidents','Handover'] as Tab[]).map(name=><Pressable key={name}
    accessibilityRole="tab" accessibilityState={{selected:tab===name}} onPress={()=>{setTab(name);setObForm(false);setMessage('');}}
    style={[styles.navItem,tab===name&&styles.navSelected]}><Text style={[styles.navText,tab===name&&styles.navTextSelected]}>{name}</Text></Pressable>)}</View>}
  </>}
 </View>;
}
export default function App(){return <SafeAreaProvider><InnerApp/></SafeAreaProvider>;}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.background},center:{flex:1,alignItems:'center',justifyContent:'center'},
 login:{flexGrow:1,justifyContent:'center',padding:24,gap:18},brand:{fontSize:13,fontWeight:'800',letterSpacing:1.2,color:colors.green},
 header:{backgroundColor:colors.white,borderBottomWidth:1,borderColor:colors.border,minHeight:64,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:8},
 content:{padding:16,paddingBottom:32,gap:16},back:{minHeight:48,justifyContent:'center',alignSelf:'flex-start',paddingHorizontal:4},backText:{color:colors.green,fontSize:17,fontWeight:'700'},
 row:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},pending:{backgroundColor:'#F0EAF8',borderRadius:16,padding:16,gap:10},
 received:{backgroundColor:colors.soft,borderRadius:16,padding:16,gap:10},urgent:{backgroundColor:'#FCEAE7',borderRadius:16,padding:16,gap:8},
 record:{backgroundColor:colors.white,borderRadius:16,borderColor:colors.border,borderWidth:1,padding:16,gap:10,minHeight:110},
 notice:{backgroundColor:colors.white,borderRadius:12,padding:14,borderWidth:1,borderColor:colors.danger},
 nav:{flexDirection:'row',backgroundColor:colors.white,borderTopWidth:1,borderColor:colors.border},
 navItem:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',paddingHorizontal:2},
 navSelected:{borderTopWidth:3,borderColor:colors.green},navText:{color:colors.muted,fontSize:12,fontWeight:'700'},
 navTextSelected:{color:colors.green}
});
