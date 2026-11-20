import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as Crypto from 'expo-crypto';
import {missedCheckIn} from './shift-coverage';
import {HomeActions, HomeQuickAction, StatCard, homeStyles} from './HomeQuickAction';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Image, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {supabase} from './api';
import {InviteGuardScreen} from './auth/InviteGuardScreen';
import {COLORS,HomeHeader,HomeHeaderControl,ScreenHeader} from './components';
import {countSupervisorOverview} from './supervisor-overview';

/* Site information comes from an RLS-filtered Supabase query, NOT locally held guard records. */
type Site = {id:string; name:string; code:string};
type Incident = {
  id:string; public_number:string; site_id:string; category:string; severity:string;
  description:string; status:string; reported_at:string; received_at:string;
};
type Occurrence = {
  id:string; site_id:string; category:string; narrative:string;
  event_at:string; received_at:string;
};
type Handover = {
  id:string; site_id:string; notes:string; submitted_at:string;
  post:string|null;
  accepted_at:string|null; outgoing_guard_id:string; incoming_guard_id:string|null;
};
type Shift = {
  checked_in_at?:string|null;post?:string|null;
  id:string; site_id:string; guard_id:string; status:string;
  started_at:string; ended_at:string|null;
  presence_status:'on_duty'|'on_break'|null;
};
type IncidentUpdate = {id:string; author_id:string; update_type:string; note:string; created_at:string};
type Page = 'Home'|'Incidents'|'Guards'|'Sites'|'More'|'Shifts'|'OB'|'Handovers';
type LoadState = 'loading'|'ready'|'error';
type IconName = React.ComponentProps<typeof Ionicons>['name'];
const ALL_SITES='all';
const GREEN=COLORS.primary;
const NAVY='#152836';
const BG='#F6F8F9';
const RED='#B43732';
const MUTED='#60727c';
const BORDER='#DEE7E8';
const clockTime = (iso:string) => {
  const d=new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString('en-ZW',{timeZone:'Africa/Harare',hour:'2-digit',minute:'2-digit'}) : '—';
};
const dateText = (iso:string) => {
  const d=new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB',{timeZone:'Africa/Harare'}) : 'Unknown time';
};
const pretty = (raw:string) => raw.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const Icon=({name,color=GREEN,size=23}: {name:IconName;color?:string;size?:number})=>
  <Ionicons name={name} size={size} color={color}/>;

function Action({label,onPress,disabled=false,secondary=false}: {
  label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
    style={({pressed})=>[styles.action,secondary&&styles.actionSecondary,disabled&&{opacity:.45},pressed&&styles.pressed]}>
    <Text style={[styles.actionText,secondary&&styles.actionTextSecondary]}>{label}</Text>
  </Pressable>;
}
function RecordCard({children}: {children:React.ReactNode}) {
  return <View style={styles.card}>{children}</View>;
}
function Empty({message}: {message:string}) {
  return <RecordCard><Text style={styles.muted}>{message}</Text></RecordCard>;
}
function NavRow({icon,title,subtitle,onPress}: {icon:IconName;title:string;subtitle:string;onPress:()=>void}){
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({pressed})=>[styles.navRow,pressed&&styles.pressed]}>
    <View style={styles.navRowIcon}><Icon name={icon} color={GREEN}/></View>
    <View style={{flex:1,gap:3}}><Text style={styles.heading}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>
    <Icon name="chevron-forward-outline" color={MUTED} size={18}/>
  </Pressable>;
}
const bottomTabs: {page:Page;label:string;icon:IconName;selected:IconName}[] = [
  {page:'Home',label:'Home',icon:'home-outline',selected:'home'},
  {page:'Incidents',label:'Incidents',icon:'shield-outline',selected:'shield'},
  {page:'Guards',label:'Guards',icon:'people-outline',selected:'people'},
  {page:'Sites',label:'Sites',icon:'business-outline',selected:'business'},
  {page:'More',label:'More',icon:'ellipsis-horizontal',selected:'ellipsis-horizontal-circle'},
];

// Only server-received records are shown in the supervisor workspace.
// Offline guard outboxes cannot be remotely inspected and are never included in its counts.
export function SupervisorWorkspace({userId,onSignOut}: {userId:string;onSignOut:()=>Promise<void>}) {
  const {width}=useWindowDimensions();
  const [page,setPage]=useState<Page>('Home');
  const [allOb,setAllOb]=useState(false);
  const [sites,setSites]=useState<Site[]>([]);
  const [siteId,setSiteId]=useState<string>(ALL_SITES);
  const [siteStatus,setSiteStatus]=useState<LoadState>('loading');
  const [sitePickerOpen,setSitePickerOpen]=useState(false);
  const [profileName,setProfileName]=useState('Supervisor');
  const [loading,setLoading]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [incidents,setIncidents]=useState<Incident[]>([]);
  const [ob,setOb]=useState<Occurrence[]>([]);
  const [handovers,setHandovers]=useState<Handover[]>([]);
  const [shifts,setShifts]=useState<Shift[]>([]);
  const [lastReceived,setLastReceived]=useState<string|null>(null);
  const [selected,setSelected]=useState<Incident|null>(null);
  const [photoUrl,setPhotoUrl]=useState<string|null>(null);
  const [photoError,setPhotoError]=useState('');
  const [updates,setUpdates]=useState<IncidentUpdate[]>([]);
  const [detailError,setDetailError]=useState('');
  const [ackBusy,setAckBusy]=useState(false);
  const [responseNote,setResponseNote]=useState('');
  const responseAttempt=useRef<{id:string;incident:string;action:string;note:string}|null>(null);
  const [showInvite,setShowInvite]=useState(false);
  const requestSequence=useRef(0);

  useEffect(()=>{
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(showInvite){setShowInvite(false);return true;}
      if(sitePickerOpen){setSitePickerOpen(false);return true;}
      if(selected){setSelected(null);return true;}
      if(page!=='Home'){setPage('Home');return true;}
      return false;
    });
    return ()=>listener.remove();
  },[showInvite,sitePickerOpen,selected,page]);

  const siteIds=useMemo(()=>siteId===ALL_SITES?sites.map(s=>s.id):sites.some(s=>s.id===siteId)?[siteId]:[],[siteId,sites]);
  const selectedSite=sites.find(s=>s.id===siteId);
  const scopeTitle=siteId===ALL_SITES?'All assigned sites':selectedSite?.name??'Assigned site';
  const siteName=(id:string)=>sites.find(s=>s.id===id)?.name??'Assigned site';
  const greetingName=profileName.trim()||'Supervisor';

  const loadSites=useCallback(async()=>{
    setSiteStatus('loading');setError('');
    const [{data,error:e},{data:p}] = await Promise.all([
      supabase.from('sites').select('id,name,code').order('name'),
      supabase.from('profiles').select('display_name').eq('id',userId).maybeSingle(),
    ]);
    if(e){setError(`Unable to load assigned sites: ${e.message}`);setSiteStatus('error');return;}
    const siteList=(data??[]) as Site[];
    setSites(siteList);
    setSiteId(previous=>previous===ALL_SITES||siteList.some(s=>s.id===previous)?previous:ALL_SITES);
    if(p && typeof p.display_name==='string')setProfileName(p.display_name);
    setSiteStatus('ready');
  },[userId]);
  useEffect(()=>{void loadSites();},[loadSites]);

  const refresh=useCallback(async()=>{
    if(siteStatus!=='ready'||!siteIds.length) return;
    const requestNo=++requestSequence.current;
    setRefreshing(true);setError('');
    // All selected IDs originated from the authenticated site's RLS-scoped query.
    const [i,o,h,s]=await Promise.all([
      supabase.from('incidents')
        .select('id,public_number,site_id,category,severity,description,status,reported_at,received_at')
        .in('site_id',siteIds).order('received_at',{ascending:false}).limit(100),
      supabase.from('occurrence_entries')
        .select('id,site_id,category,narrative,event_at,received_at')
        .in('site_id',siteIds).order('received_at',{ascending:false}).limit(200),
      supabase.from('shift_handovers')
        .select('id,site_id,notes,post,submitted_at,accepted_at,outgoing_guard_id,incoming_guard_id')
        .in('site_id',siteIds).order('submitted_at',{ascending:false}).limit(100),
      supabase.from('shifts')
        .select('*')
        .in('site_id',siteIds).in('status',['active','scheduled']).order('started_at',{ascending:false}).limit(200),
    ]);
    if(requestNo!==requestSequence.current)return;
    if(i.error||o.error||h.error||s.error){
      setError(`Refresh failed: ${i.error?.message??o.error?.message??h.error?.message??s.error?.message}. Previously loaded data may be stale.`);
    } else {
      setIncidents((i.data??[]) as Incident[]);
      setOb((o.data??[]) as Occurrence[]);
      setHandovers((h.data??[]) as Handover[]);
      setShifts((s.data??[]) as Shift[]);
      setLastReceived(new Date().toISOString());
    }
    setRefreshing(false);
  },[siteIds,siteStatus]);
  useEffect(()=>{
    requestSequence.current += 1;
    setSelected(null);setIncidents([]);setOb([]);setHandovers([]);setShifts([]);setLastReceived(null);
    if(siteStatus==='ready' && siteIds.length)void refresh();
  },[refresh,siteStatus]);
  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>{
      if(state==='active'&&siteStatus==='ready')void refresh();
    });
    return ()=>listener.remove();
  },[refresh,siteStatus]);
  useEffect(()=>{
    if(!selected){setUpdates([]);return;}
    let active=true;
    setDetailError('');
    void supabase.from('incident_updates').select('id,author_id,update_type,note,created_at')
      .eq('incident_id',selected.id).order('created_at',{ascending:true}).then(({data,error:e})=>{
        if(!active)return;
        if(e)setDetailError(`Unable to load review history: ${e.message}`);
        else setUpdates((data??[]) as IncidentUpdate[]);
      });
    return ()=>{active=false;};
  },[selected?.id,selected?.status]);
  useEffect(()=>{
    let current=true;
    setPhotoUrl(null);setPhotoError('');
    if(!selected)return ()=>{current=false;};
    void (async()=>{
      const {data,error:e}=await supabase.from('incident_photos').select('object_path')
        .eq('incident_id',selected.id).maybeSingle();
      if(!current)return;
      if(e){setPhotoError('Photo information unavailable: '+e.message);return;}
      if(!data)return;
      const {data:signed,error:signError}=await supabase.storage.from('incident-evidence').createSignedUrl(data.object_path,300);
      if(!current)return;
      if(signError){setPhotoError('Photo is not available yet. Refresh to retry.');return;}
      setPhotoUrl(signed.signedUrl);
    })();
    return ()=>{current=false;};
  },[selected?.id]);

  const overview=useMemo(()=>countSupervisorOverview(incidents,shifts,new Date().toISOString()),[incidents,shifts]);
  const {awaiting,openCases:openCount,activeShifts,onDuty:dutyGuards,onBreak:breakGuards}=overview;
  const attentionHandovers=handovers.filter(h=>!h.accepted_at && (h.incoming_guard_id || !h.post ||
    !activeShifts.some(s=>s.site_id===h.site_id&&s.post===h.post&&s.presence_status==='on_duty')));
  const latestActivity=useMemo(()=>[
    ...handovers.map(h=>({kind:'handover' as const,id:h.id,title:h.accepted_at?'Handover acknowledged':'Handover submitted',
      subtitle:siteName(h.site_id),when:h.accepted_at??h.submitted_at,incident:null})),
    ...shifts.flatMap(s=>s.checked_in_at?[{kind:'shift' as const,id:s.id,title:'Guard checked in',
      subtitle:[siteName(s.site_id),s.post].filter(Boolean).join(' · '),when:s.checked_in_at,incident:null}]:[]),
    ...incidents.map(i=>({kind:'incident' as const,id:i.id,title:`${pretty(i.category)} · ${i.public_number}`,
      subtitle:`${siteName(i.site_id)} · ${pretty(i.status)}`,when:i.received_at,incident:i})),
    ...ob.map(o=>({kind:'ob' as const,id:o.id,title:`${pretty(o.category)} · OB entry`,
      subtitle:siteName(o.site_id),when:o.received_at,incident:null})),
  ].sort((a,b)=>Date.parse(b.when)-Date.parse(a.when)).slice(0,5),[incidents,ob,sites,handovers,shifts]);

  function navigate(next:Page){setSelected(null);setPage(next);}
  function viewIncident(incident:Incident){setResponseNote('');responseAttempt.current=null;setSelected(incident);setPage('Incidents');}
  async function recordResponse(action:'progress'|'resolved'){
    if(!selected||ackBusy)return;
    const note=responseNote.trim();
    if(note.length<2||note.length>1000){setDetailError('Enter a note between 2 and 1,000 characters.');return;}
    let attempt=responseAttempt.current;
    if(!attempt||attempt.incident!==selected.id||attempt.action!==action||attempt.note!==note){
      attempt={id:Crypto.randomUUID(),incident:selected.id,action,note};
      responseAttempt.current=attempt;
    }
    setAckBusy(true);setDetailError('');
    try{
      const {error:e}=await supabase.rpc('record_incident_response',{
        p_update_id:attempt.id,p_incident_id:attempt.incident,p_action:attempt.action,p_note:attempt.note,
      });
      if(e)throw e;
      const {data,error:readError}=await supabase.from('incidents')
        .select('id,public_number,site_id,category,severity,description,status,reported_at,received_at')
        .eq('id',selected.id).in('site_id',siteIds).single();
      if(readError||!data)throw readError??new Error('Incident refresh failed');
      const {data:history,error:historyError}=await supabase.from('incident_updates')
        .select('id,author_id,update_type,note,created_at').eq('incident_id',selected.id)
        .order('created_at',{ascending:true});
      if(historyError)throw historyError;
      setUpdates((history??[]) as IncidentUpdate[]);
      setSelected(data as Incident);setResponseNote('');responseAttempt.current=null;
      await refresh();
    }catch(e){setDetailError(e instanceof Error?e.message:'Response could not be confirmed. Retry to check its receipt.');}
    finally{setAckBusy(false);}
  }
  async function performAcknowledge(id:string){
    if(ackBusy)return;
    setAckBusy(true);setDetailError('');
    const {error:e}=await supabase.rpc('acknowledge_incident',{
      p_incident_id:id,p_note:'Reviewed and acknowledged by supervisor',
    });
    if(e){setDetailError(`Acknowledgement failed: ${e.message}`);setAckBusy(false);return;}
    const {data,error:fetchError}=await supabase.from('incidents')
      .select('id,public_number,site_id,category,severity,description,status,reported_at,received_at')
      .eq('id',id).in('site_id',siteIds).single();
    if(fetchError||!data){setDetailError(`Acknowledged on server, but refresh failed: ${fetchError?.message??'Record not found'}`);}
    else setSelected(data as Incident);
    await refresh();
    setAckBusy(false);
  }
  function confirmAcknowledge(id:string){
    Alert.alert('Acknowledge incident?',
      'Confirm you have reviewed this report. In-app acknowledgement does not dispatch emergency assistance.',[
        {text:'Cancel',style:'cancel'},
        {text:'Acknowledge',onPress:()=>{void performAcknowledge(id);}},
      ]);
  }
  async function signOut(){
    setLoading(true);
    try{await onSignOut();}
    catch(e){setError(e instanceof Error?e.message:'Could not sign out');}
    finally{setLoading(false);}
  }
  if(showInvite)return <InviteGuardScreen onClose={()=>setShowInvite(false)}/>;

  const contentReady=siteStatus==='ready'&&sites.length>0;
  const stale=!lastReceived;
  const statusLine=lastReceived?`Last refreshed ${clockTime(lastReceived)}`:'Waiting for server data';
  const navigationActive=bottomTabs.some(t=>t.page===page)?page:'More';
  const bottomTabSize=width<380?10:11;

  return <View style={[styles.screen,page==='Home'&&{backgroundColor:COLORS.background}]}>
    {page==='Home'?<HomeHeader
      greeting={new Date().getHours()<12?'Good morning':new Date().getHours()<18?'Good afternoon':'Good evening'}
      name={greetingName}
      subtitle="Supervisor workspace"
      brandAction={<HomeHeaderControl kind="icon" accessibilityLabel="Account and additional options"
        onPress={()=>navigate('More')}>
        <View style={{width:32,height:32,borderRadius:16,backgroundColor:'#285748',alignItems:'center',justifyContent:'center'}}>
          <Text style={{color:'white',fontWeight:'700',fontSize:12}}>{greetingName.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}</Text>
        </View>
      </HomeHeaderControl>}
      contextAction={<Pressable accessibilityRole="button" accessibilityLabel="Choose assigned site" onPress={()=>setSitePickerOpen(true)}
        style={{backgroundColor:'white',borderColor:'#C9DCD1',borderWidth:1,borderRadius:9,minHeight:48,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8}}>
        <Icon name="location-outline" size={17}/><Text numberOfLines={1} style={{flex:1,color:NAVY}}>{scopeTitle}</Text><Icon name="chevron-down" size={16}/>
      </Pressable>}
    />:<ScreenHeader
      title={({Incidents:'Incident Inbox',Guards:'Guards',Sites:'Sites',More:'More',Shifts:'Shifts & Rosters',OB:'Occurrence Book',Handovers:'Shift Handovers',Home:'Overview'} as Record<Page,string>)[page]}
      onBack={()=>navigate('Home')}
      rightAction={<Pressable accessibilityRole="button" accessibilityLabel="Choose assigned site" onPress={()=>setSitePickerOpen(true)} style={styles.screenSiteButton}>
        <Icon name="location-outline" size={20} color="#FFFFFF"/>
      </Pressable>}
    />}

    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {siteStatus==='loading'?<ActivityIndicator color={GREEN} size="large" style={{marginVertical:36}}/>:
       siteStatus==='error'?<RecordCard><Text style={styles.error}>{error}</Text><Action label="Retry loading sites" onPress={()=>{void loadSites();}}/></RecordCard>:
       sites.length===0?<Empty message="No assigned sites are available for this account. Contact an administrator."/>:null}

      {contentReady?<>
        {!!error?<View style={styles.errorCard}><Icon name="alert-circle-outline" color={RED}/><Text style={[styles.error,{flex:1}]}>{error}</Text></View>:null}
        {page!=='Home'&&<View style={styles.refreshRow}>
          <Text style={styles.smallNote}>{statusLine} · Server records only</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh supervisor data" disabled={refreshing}
            onPress={()=>{void refresh();}} style={styles.refreshButton}>
            {refreshing?<ActivityIndicator color={GREEN} size="small"/>:<Icon name="refresh-outline" size={18}/>}
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>}

        {page==='Home'&&<>
          <Text style={homeStyles.heading}>Needs attention</Text>
          {!awaiting&&!shifts.some(s=>missedCheckIn(s))&&!attentionHandovers.length&&
            <Empty message={stale?'Awaiting server records…':'No outstanding items in the loaded records.'}/>}
          {incidents.filter(i=>i.status==='reported').sort((a,b)=>Number(['high','critical'].includes(b.severity))-Number(['high','critical'].includes(a.severity))).map(i=>
            <Pressable key={i.id} accessibilityRole="button" onPress={()=>viewIncident(i)} style={styles.errorCard}>
              <Icon name="warning-outline" color={RED}/>
              <View style={{flex:1}}><Text style={styles.heading}>{pretty(i.severity)} incident needs acknowledgement</Text>
                <Text style={styles.muted}>{i.public_number} · {pretty(i.category)} · {siteName(i.site_id)}</Text>
                <Text style={styles.textLink}>Review incident →</Text></View>
            </Pressable>)}
          {shifts.filter(s=>missedCheckIn(s)).map(s=><NavRow key={s.id} icon="time-outline" title="Missed check-in" subtitle={s.post??siteName(s.site_id)} onPress={()=>Alert.alert('Scheduled shift',siteName(s.site_id)+' · '+(s.post??'Post unassigned')+' · '+dateText(s.started_at)+' · Guard '+s.guard_id)}/>)}
          {attentionHandovers.map(h=><NavRow key={h.id} icon="swap-horizontal" title={h.incoming_guard_id?'Pending handover':'Coverage gap · no incoming guard'} subtitle={siteName(h.site_id)+' · '+(h.post??'Post unassigned')+' · '+clockTime(h.submitted_at)} onPress={()=>Alert.alert('Handover '+h.id,h.notes+'\nOutgoing: '+h.outgoing_guard_id+'\nIncoming: '+(h.incoming_guard_id??'Unassigned'))}/>)}
          <Text style={homeStyles.heading}>Operational overview</Text>
          <Text style={styles.muted}>{scopeTitle} · Latest loaded records · {statusLine}</Text>
          <HomeActions>
            <StatCard label="Sites in view" value={siteIds.length}/>
            <StatCard label="Active guards" value={stale?'—':new Set(activeShifts.map(s=>s.guard_id)).size}/>
            <StatCard label="On duty" value={stale?'—':dutyGuards}/>
            <StatCard label="Open incidents" value={stale?'—':openCount}/>
            <StatCard label="Pending handovers" value={stale?'—':handovers.filter(h=>!h.accepted_at).length}/>
            <StatCard label="Missed check-ins" value={stale?'—':shifts.filter(s=>missedCheckIn(s)).length}/>
          </HomeActions>
          <Text style={homeStyles.heading}>Management</Text>
          <HomeActions>
            <HomeQuickAction title="Invite guard" subtitle="Assign site access" icon="person-add-outline" onPress={()=>setShowInvite(true)}/>
            <HomeQuickAction title="Review incidents" subtitle="Open incident inbox" icon="warning-outline" onPress={()=>navigate('Incidents')}/>
            <HomeQuickAction title="View shifts" subtitle="Active assignments" icon="calendar-outline" onPress={()=>navigate('Shifts')}/>
            <HomeQuickAction title="View sites" subtitle="Managed locations" icon="business-outline" onPress={()=>navigate('Sites')}/>
          </HomeActions>
          <Text style={homeStyles.heading}>Scheduled guards</Text>
          <RecordCard><Text style={styles.muted}>Scheduled assignments · check-in recorded separately</Text>
            {shifts.filter(s=>s.status==='scheduled').map(s=><Text key={s.id} style={styles.paragraph}>{s.post??siteName(s.site_id)} · Scheduled {clockTime(s.started_at)} · Guard {s.guard_id.slice(-8)}</Text>)}
            {activeShifts.filter(s=>s.checked_in_at).map(s=><Text key={s.id} style={styles.paragraph}>{s.post??siteName(s.site_id)} · Checked in {clockTime(s.checked_in_at!)} · Guard {s.guard_id.slice(-8)}</Text>)}
          </RecordCard>
          <Text style={homeStyles.heading}>Recent occurrence book</Text>
          {ob.length?ob.slice(0,3).map(o=><NavRow key={o.id} icon="book-outline" title={pretty(o.category)} subtitle={clockTime(o.event_at)+' · '+siteName(o.site_id)} onPress={()=>navigate('OB')}/>):<Empty message={stale?'Waiting for entries…':'No entries received.'}/>}
          <Text style={homeStyles.heading}>Recent activity</Text>
          {latestActivity.length?latestActivity.map(a=><View key={a.kind+a.id} style={styles.card}>
            <Text style={styles.heading}>{a.title}</Text><Text style={styles.muted}>{a.subtitle} · {dateText(a.when)}</Text>
          </View>):<Empty message={stale?'Waiting for activity…':'No activity received.'}/>}
        </>}

        {page==='Incidents'&&(selected?<>
          <Action label="← Back to incident inbox" secondary onPress={()=>setSelected(null)}/>
          <Text style={styles.h1}>{selected.public_number}</Text>
          <RecordCard>
            <Text style={styles.kicker}>INCIDENT REVIEW · {selected.status.toUpperCase()}</Text>
            <Text style={styles.heading}>{pretty(selected.category)} · {pretty(selected.severity)}</Text>
            <Text style={styles.paragraph}>{selected.description}</Text>
            <Text style={styles.muted}>Site: {siteName(selected.site_id)}</Text>
            <Text style={styles.muted}>Occurred/reported: {dateText(selected.reported_at)}</Text>
            <Text style={styles.muted}>Received by server: {dateText(selected.received_at)}</Text>
            {photoUrl?<Image accessibilityLabel="Incident evidence photo" source={{uri:photoUrl}}
              style={{width:'100%',height:240,borderRadius:10}} resizeMode="contain"/>:null}
            {photoError?<Text style={styles.error}>{photoError}</Text>:null}
            {selected.status==='reported'&&<Action label={ackBusy?'Acknowledging…':'Acknowledge incident'}
              disabled={ackBusy||refreshing} onPress={()=>confirmAcknowledge(selected.id)}/>}
            {(selected.status==='acknowledged'||selected.status==='in_progress')&&<>
              <Text style={styles.heading}>Supervisor response</Text>
              <TextInput accessibilityLabel="Response note" multiline maxLength={1000} value={responseNote}
                onChangeText={setResponseNote} placeholder="Enter follow-up or resolution details" style={styles.responseInput}/>
              <Action label={ackBusy?'Saving…':'Add follow-up'} disabled={ackBusy} onPress={()=>void recordResponse('progress')}/>
              <Action label="Resolve incident" secondary disabled={ackBusy} onPress={()=>void recordResponse('resolved')}/>
            </>}
            <Text style={styles.muted}>Acknowledgement does not dispatch assistance. Use established emergency procedures.</Text>
          </RecordCard>
          <Text style={styles.heading}>Review history</Text>
          {detailError?<Text style={styles.error}>{detailError}</Text>:null}
          {updates.length===0?<Empty message="No supervisor updates recorded yet."/>:
            updates.map(u=><RecordCard key={u.id}><Text style={styles.heading}>{pretty(u.update_type)}</Text>
              <Text style={styles.paragraph}>{u.note}</Text><Text style={styles.muted}>{dateText(u.created_at)} · Actor {u.author_id}</Text></RecordCard>)}
        </>:<>
          <Text style={styles.muted}>Server-received incidents · Latest 100 · {scopeTitle}</Text>
          {!incidents.length?<Empty message={lastReceived?'No incidents have been received for these sites.':'Awaiting first successful server refresh.'}/>:
            incidents.map(i=><Pressable key={i.id} accessibilityRole="button" accessibilityLabel={`Review ${i.public_number}`} onPress={()=>viewIncident(i)}>
              <RecordCard>
                <View style={styles.spaceBetween}><Text style={styles.heading}>{i.public_number}</Text>
                  <Text style={[styles.status,i.status==='reported'&&styles.urgent]}>{pretty(i.status)}</Text></View>
                <Text style={styles.muted}>{siteName(i.site_id)} · {pretty(i.category)} · {pretty(i.severity)}</Text>
                <Text style={styles.paragraph} numberOfLines={3}>{i.description}</Text>
                <Text style={styles.muted}>Reported {dateText(i.reported_at)}</Text>
                <Text style={styles.kicker}>Review report →</Text>
              </RecordCard></Pressable>)}
        </>)}

        {page==='Guards'&&<>
          <Text style={styles.muted}>Presence reported by active, authorized shift records. Names for other guards require a separate staff directory permission.</Text>
          <RecordCard>
            <View style={styles.spaceBetween}><Text style={styles.heading}>Guards on duty</Text><Text style={styles.metricCount}>{stale?'—':dutyGuards}</Text></View>
            <View style={styles.spaceBetween}><Text style={styles.heading}>On break</Text><Text style={styles.metricCount}>{stale?'—':breakGuards}</Text></View>
            <Action label="Invite a guard" onPress={()=>setShowInvite(true)}/>
            <Text style={styles.muted}>Invitation assigns site access. Scheduling a shift requires authorized administration.</Text>
          </RecordCard>
          {!activeShifts.length?<Empty message="No active shift records loaded for these sites."/>:
            activeShifts.map(s=><RecordCard key={s.id}>
              <View style={styles.spaceBetween}><Text style={styles.heading}>Guard ID · {s.guard_id.slice(0,8)}</Text>
                <Text style={[styles.status,{color:s.presence_status==='on_break'?'#A16C12':GREEN}]}>
                  {s.presence_status==='on_break'?'On Break':s.presence_status==='on_duty'?'On Duty':'Presence unknown'}</Text></View>
              <Text style={styles.muted}>{siteName(s.site_id)} · Shift started {dateText(s.started_at)}</Text>
            </RecordCard>)}
        </>}

        {page==='Sites'&&<>
          <Text style={styles.muted}>Sites you are authorized to supervise. Adding new client sites requires an approved management workflow.</Text>
          {sites.filter(s=>siteId===ALL_SITES||s.id===siteId).map(s=><Pressable key={s.id} accessibilityRole="button" onPress={()=>{setSiteId(s.id);navigate('Home');}}>
            <RecordCard><View style={styles.siteListRow}><View style={styles.siteListIcon}><Icon name="business-outline"/></View>
              <View style={{flex:1,gap:4}}><Text style={styles.heading}>{s.name}</Text><Text style={styles.muted}>Site code: {s.code}</Text>
                <Text style={styles.muted}>{activeShifts.filter(sh=>sh.site_id===s.id).length} active shift(s) in loaded records</Text></View>
              <Icon name="chevron-forward-outline" color={MUTED}/></View></RecordCard>
          </Pressable>)}
        </>}

        {page==='Shifts'&&<>
          <Text style={styles.muted}>Active shift overview. Scheduling, ending shifts and handover acceptance are not enabled in this mobile build.</Text>
          {!activeShifts.length?<Empty message="No active shift records for this selection."/>:
            activeShifts.map(s=><RecordCard key={s.id}>
              <Text style={styles.heading}>{siteName(s.site_id)}</Text>
              <Text style={styles.muted}>Guard ID: {s.guard_id.slice(0,8)}</Text>
              <Text style={styles.paragraph}>Started: {dateText(s.started_at)}</Text>
              <Text style={styles.muted}>Presence: {s.presence_status==='on_break'?'On Break':s.presence_status==='on_duty'?'On Duty':'Not yet reported'}</Text>
            </RecordCard>)}
        </>}

        {page==='OB'&&<>
          <Action secondary label={allOb?'All entries · Show today':'Today · Show all entries'} onPress={()=>setAllOb(!allOb)}/>
          <Text style={styles.muted}>Server-received occurrence entries · Latest 200 · {scopeTitle}</Text>
          {!ob.length?<Empty message="No occurrence entries received for these sites."/>:
            ob.filter(o=>allOb||new Date(o.event_at).toLocaleDateString('en-CA',{timeZone:'Africa/Harare'})===new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Harare'})).map(o=><RecordCard key={o.id}>
              <Text style={styles.heading}>{pretty(o.category)} · {siteName(o.site_id)}</Text>
              <Text style={styles.paragraph}>{o.narrative}</Text>
              <Text style={styles.muted}>Event: {dateText(o.event_at)}</Text><Text style={styles.muted}>Received: {dateText(o.received_at)}</Text>
            </RecordCard>)}
        </>}

        {page==='Handovers'&&<>
          <Text style={styles.muted}>Read-only, server-received handovers. Acceptance and corrections are not yet available.</Text>
          {!handovers.length?<Empty message="No handover records have been received for these sites."/>:
            handovers.map(h=><RecordCard key={h.id}>
              <Text style={styles.heading}>{h.accepted_at?'Accepted':'Awaiting acceptance'} · {siteName(h.site_id)}</Text>
              <Text style={styles.paragraph}>{h.notes}</Text>
              <Text style={styles.muted}>Submitted: {dateText(h.submitted_at)}</Text>
            </RecordCard>)}
        </>}

        {page==='More'&&<View style={styles.moreCard}>
          <NavRow icon="people-outline" title="Guards" subtitle="Duty status and invitations" onPress={()=>navigate('Guards')}/>
          <NavRow icon="refresh-outline" title="Refresh dashboard" subtitle={statusLine} onPress={()=>void refresh()}/>
          <NavRow icon="warning-outline" title="Emergency procedures" subtitle="Approved assistance channels" onPress={()=>Alert.alert('Emergency procedures','Use approved emergency telephone or radio procedures.')}/>
          <NavRow icon="calendar-outline" title="Shifts & Rosters" subtitle="View active shift assignments" onPress={()=>navigate('Shifts')}/>
          <NavRow icon="reader-outline" title="Occurrence Book" subtitle="Server-received duty entries" onPress={()=>navigate('OB')}/>
          <NavRow icon="swap-horizontal-outline" title="Handovers" subtitle="Review handover records" onPress={()=>navigate('Handovers')}/>
          <NavRow icon="person-add-outline" title="Invite Guard" subtitle="Send an authorized invitation" onPress={()=>setShowInvite(true)}/>
          <NavRow icon="document-text-outline" title="Reports" subtitle="Advanced report generation is not yet available" onPress={()=>Alert.alert('Reports','Advanced report generation is planned. No export was created.')}/>
          <NavRow icon="log-out-outline" title={loading?'Signing out…':'Sign out'} subtitle="Leave supervisor workspace" onPress={()=>{void signOut();}}/>
        </View>}
      </>:null}
    </ScrollView>

    <View style={styles.bottomNav}>
      {bottomTabs.map(t=><Pressable key={t.page} accessibilityRole="tab"
        accessibilityLabel={t.label} accessibilityState={{selected:navigationActive===t.page}}
        onPress={()=>navigate(t.page)} style={({pressed})=>[styles.bottomTab,navigationActive===t.page&&styles.selectedTab,pressed&&styles.pressed]}>
        <Icon name={navigationActive===t.page?t.selected:t.icon} color={navigationActive===t.page?GREEN:MUTED} size={22}/>
        <Text style={[styles.bottomLabel,{fontSize:bottomTabSize},navigationActive===t.page&&styles.selectedTabLabel]} numberOfLines={1}>{t.label}</Text>
      </Pressable>)}
    </View>

    <Modal transparent visible={sitePickerOpen} onRequestClose={()=>setSitePickerOpen(false)} animationType="fade">
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} accessibilityLabel="Close site selector" onPress={()=>setSitePickerOpen(false)}/>
        <View style={styles.modalSheet}>
          <View style={styles.spaceBetween}><Text style={styles.h2}>Assigned sites</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close site selector" onPress={()=>setSitePickerOpen(false)} style={styles.closeButton}>
              <Icon name="close" color={NAVY}/></Pressable></View>
          <Text style={styles.muted}>Only locations assigned to your supervisor account are shown.</Text>
          <ScrollView style={{maxHeight:380}}>
            {[{id:ALL_SITES,name:'All assigned sites',code:`${sites.length} locations`},...sites].map(s=><Pressable key={s.id} accessibilityRole="button"
              onPress={()=>{setSiteId(s.id);setSitePickerOpen(false);}} style={[styles.siteOption,siteId===s.id&&styles.siteOptionActive]}>
              <Icon name={s.id===ALL_SITES?'layers-outline':'business-outline'} color={GREEN}/>
              <View style={{flex:1,gap:3}}><Text style={styles.heading}>{s.name}</Text><Text style={styles.muted}>{s.code}</Text></View>
              {siteId===s.id?<Icon name="checkmark-circle" color={GREEN}/>:null}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#fff'},
  scroll:{flex:1},content:{paddingHorizontal:16,paddingTop:14,paddingBottom:28,gap:14},
  headerSitePillText:{fontSize:12,fontWeight:'700',color:GREEN,flexShrink:1},
  screenSiteButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:24},
  h1:{fontSize:24,fontWeight:'800',color:NAVY},h2:{fontSize:21,fontWeight:'800',color:NAVY},
  heading:{fontSize:16,fontWeight:'700',color:NAVY},paragraph:{fontSize:14,lineHeight:21,color:NAVY},
  muted:{fontSize:12,lineHeight:19,color:MUTED},smallNote:{fontSize:11,lineHeight:16,color:MUTED,flex:1},
  kicker:{fontSize:11,fontWeight:'800',letterSpacing:.5,color:GREEN},
  error:{fontSize:13,fontWeight:'600',lineHeight:19,color:RED},errorCard:{padding:12,borderRadius:13,backgroundColor:'#fff2f2',flexDirection:'row',alignItems:'center',gap:10},
  refreshRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:6},refreshButton:{flexDirection:'row',alignItems:'center',gap:5,minHeight:36,paddingHorizontal:5},refreshText:{fontSize:12,color:GREEN,fontWeight:'700'},
  card:{borderRadius:16,borderWidth:1,borderColor:BORDER,backgroundColor:'#fff',padding:16,gap:10},
  responseInput:{borderWidth:1,borderColor:BORDER,borderRadius:10,minHeight:88,padding:12,color:NAVY,textAlignVertical:'top'},
  status:{fontSize:12,fontWeight:'700',color:GREEN},urgent:{color:RED},
  spaceBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  action:{backgroundColor:GREEN,minHeight:48,paddingVertical:12,paddingHorizontal:15,borderRadius:12,alignItems:'center',justifyContent:'center'},
  actionSecondary:{backgroundColor:'#E9F2EF',borderWidth:1,borderColor:'#B7D4C9'},
  actionText:{color:'#fff',fontWeight:'700',fontSize:13},actionTextSecondary:{color:GREEN},
  assignmentCard:{backgroundColor:'#F3F6F6',borderRadius:14,paddingTop:12,paddingHorizontal:15,paddingBottom:14,borderLeftWidth:4,borderLeftColor:GREEN,gap:8},
  assignmentHead:{flexDirection:'row',alignItems:'center',gap:10},
  assignmentIcon:{width:55,height:55,borderRadius:28,backgroundColor:'#E2EFEA',alignItems:'center',justifyContent:'center'},
  assignmentLabel:{color:MUTED,fontSize:13},assignmentTitle:{color:NAVY,fontSize:20,fontWeight:'800'},assignmentSub:{color:MUTED,fontSize:12},
  activeBadge:{borderRadius:11,backgroundColor:'#D9F3E3',paddingVertical:8,paddingHorizontal:8},activeBadgeText:{fontSize:11,fontWeight:'800',color:GREEN},
  metricStrip:{flexDirection:'row',alignItems:'stretch'},
  metricItem:{flex:1,alignItems:'center',justifyContent:'center',gap:4,minWidth:0,paddingHorizontal:3},metricDivider:{borderLeftWidth:1,borderLeftColor:'#D3DEE0'},
  metricCount:{color:NAVY,fontSize:21,fontWeight:'800'},metricLabel:{color:MUTED,fontSize:11,textAlign:'center'},
  limitNote:{color:MUTED,fontSize:10,lineHeight:15},
  attentionBanner:{borderRadius:18,padding:13,flexDirection:'row',alignItems:'center',gap:12,minHeight:104},
  attentionIcon:{width:53,height:53,borderRadius:27,alignItems:'center',justifyContent:'center'},
  bannerTitle:{fontSize:15,fontWeight:'800',color:NAVY},bannerBody:{fontSize:12,lineHeight:18,color:MUTED},sos:{fontSize:16,fontWeight:'900',color:'#fff'},
  activityCard:{borderWidth:1,borderColor:BORDER,borderRadius:18,backgroundColor:'#fff',paddingHorizontal:13},
  activityRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:12,minHeight:64},activityDivider:{borderTopWidth:1,borderColor:BORDER},
  activityIcon:{width:46,height:46,borderRadius:23,alignItems:'center',justifyContent:'center'},activityTitle:{fontSize:14,fontWeight:'700',color:NAVY},activitySubtitle:{fontSize:12,color:MUTED,lineHeight:18},
  safetyNote:{fontSize:12,color:MUTED,lineHeight:18,marginBottom:4},
  textButton:{flexDirection:'row',alignItems:'center',minHeight:40,gap:2},textLink:{fontSize:13,color:GREEN,fontWeight:'700'},
  siteListRow:{flexDirection:'row',alignItems:'center',gap:12},siteListIcon:{height:48,width:48,borderRadius:24,backgroundColor:'#E8F1ED',alignItems:'center',justifyContent:'center'},
  moreCard:{backgroundColor:'#fff',borderWidth:1,borderColor:BORDER,borderRadius:16,paddingHorizontal:12},
  navRow:{minHeight:72,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#EEF1F2'},
  navRowIcon:{height:42,width:42,borderRadius:12,backgroundColor:'#EEF5F2',alignItems:'center',justifyContent:'center'},
  bottomNav:{flexDirection:'row',backgroundColor:'#fff',borderTopWidth:1,borderColor:BORDER,paddingHorizontal:7,paddingTop:7,paddingBottom:4},
  bottomTab:{flex:1,minHeight:57,borderRadius:13,alignItems:'center',justifyContent:'center',gap:4,paddingHorizontal:1},
  selectedTab:{backgroundColor:'#E9F3EF'},bottomLabel:{fontWeight:'500',color:MUTED},selectedTabLabel:{color:GREEN,fontWeight:'800'},
  modalOverlay:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(10,26,29,.43)'},
  modalSheet:{backgroundColor:'#fff',borderTopLeftRadius:25,borderTopRightRadius:25,paddingHorizontal:21,paddingTop:22,paddingBottom:38,gap:12},
  closeButton:{width:40,height:40,borderRadius:20,backgroundColor:'#F1F4F5',alignItems:'center',justifyContent:'center'},
  siteOption:{flexDirection:'row',alignItems:'center',gap:12,minHeight:64,paddingVertical:12,paddingHorizontal:10,borderRadius:12},siteOptionActive:{backgroundColor:'#ECF5F1'},
  pressed:{opacity:.74},
});
