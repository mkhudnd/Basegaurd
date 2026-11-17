import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Image, Modal, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {supabase} from './api';
import {InviteGuardScreen} from './auth/InviteGuardScreen';
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
  accepted_at:string|null; outgoing_guard_id:string; incoming_guard_id:string|null;
};
type Shift = {
  id:string; site_id:string; guard_id:string; status:string;
  started_at:string; ended_at:string|null;
  presence_status:'on_duty'|'on_break'|null;
};
type IncidentUpdate = {id:string; update_type:string; note:string; created_at:string};
type Page = 'Home'|'Incidents'|'Guards'|'Sites'|'More'|'Shifts'|'OB'|'Handovers';
type LoadState = 'loading'|'ready'|'error';
type IconName = React.ComponentProps<typeof Ionicons>['name'];
const ALL_SITES='all';
const GREEN='#174E42';
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
function QuickAction({title,subtitle,icon,color,bg,onPress}: {
  title:string;subtitle:string;icon:IconName;color:string;bg:string;onPress:()=>void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({pressed})=>[styles.quickAction,{backgroundColor:bg},pressed&&styles.pressed]}>
    <View style={[styles.quickIcon,{backgroundColor:color}]}><Icon name={icon} color="#fff" size={23}/></View>
    <View style={styles.quickText}>
      <Text style={styles.quickTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.quickSubtitle} numberOfLines={2}>{subtitle}</Text>
    </View>
    <Icon name="chevron-forward-outline" size={17} color={MUTED}/>
  </Pressable>;
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
  const [updates,setUpdates]=useState<IncidentUpdate[]>([]);
  const [detailError,setDetailError]=useState('');
  const [ackBusy,setAckBusy]=useState(false);
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
        .select('id,site_id,notes,submitted_at,accepted_at,outgoing_guard_id,incoming_guard_id')
        .in('site_id',siteIds).order('submitted_at',{ascending:false}).limit(100),
      supabase.from('shifts')
        .select('id,site_id,guard_id,status,started_at,ended_at,presence_status')
        .in('site_id',siteIds).eq('status','active').order('started_at',{ascending:false}).limit(200),
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
    void supabase.from('incident_updates').select('id,update_type,note,created_at')
      .eq('incident_id',selected.id).order('created_at',{ascending:true}).then(({data,error:e})=>{
        if(!active)return;
        if(e)setDetailError(`Unable to load review history: ${e.message}`);
        else setUpdates((data??[]) as IncidentUpdate[]);
      });
    return ()=>{active=false;};
  },[selected?.id,selected?.status]);

  const overview=useMemo(()=>countSupervisorOverview(incidents,shifts,new Date().toISOString()),[incidents,shifts]);
  const {awaiting,openCases:openCount,activeShifts,onDuty:dutyGuards,onBreak:breakGuards}=overview;
  const latestActivity=useMemo(()=>[
    ...incidents.map(i=>({kind:'incident' as const,id:i.id,title:`${pretty(i.category)} · ${i.public_number}`,
      subtitle:`${siteName(i.site_id)} · ${pretty(i.status)}`,when:i.received_at,incident:i})),
    ...ob.map(o=>({kind:'ob' as const,id:o.id,title:`${pretty(o.category)} · OB entry`,
      subtitle:siteName(o.site_id),when:o.received_at,incident:null})),
  ].sort((a,b)=>Date.parse(b.when)-Date.parse(a.when)).slice(0,3),[incidents,ob,sites]);

  function navigate(next:Page){setSelected(null);setPage(next);}
  function viewIncident(incident:Incident){setSelected(incident);setPage('Incidents');}
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

  return <View style={styles.screen}>
    <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF"/>
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require('../assets/brand-shield.png')} style={styles.brandLogo} resizeMode="contain"/>
        <Text style={styles.brand} numberOfLines={1}><Text style={styles.brandBold}>Baseguard </Text>SmartOps</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Account and additional options"
        onPress={()=>navigate('More')} style={({pressed})=>[styles.headerAvatar,pressed&&styles.pressed]}>
        <Icon name="person-outline" color={NAVY} size={22}/>
      </Pressable>
    </View>

    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {page==='Home'?<>
        <View style={styles.greetingRow}>
          <View style={{flex:1,gap:4}}>
            <Text style={styles.greeting}>Good day, Supervisor</Text>
            <Text style={styles.personName} numberOfLines={1}>{greetingName}</Text>
            <Text style={styles.welcome}>Here’s what needs attention today.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose assigned site" onPress={()=>setSitePickerOpen(true)}
            style={({pressed})=>[styles.sitePill,pressed&&styles.pressed]}>
            <Icon name="location" size={17}/>
            <Text style={styles.sitePillText} numberOfLines={1}>{siteId===ALL_SITES?'All Sites':selectedSite?.code??'Sites'}</Text>
            <Icon name="chevron-down-outline" size={15}/>
          </Pressable>
        </View>
      </>:<View style={styles.sectionHeader}>
        <Text style={styles.h1}>{({Incidents:'Incident Inbox',Guards:'Guards & Duty',Sites:'Assigned Sites',More:'More',Shifts:'Shifts & Rosters',OB:'Occurrence Book',Handovers:'Shift Handovers',Home:'Overview'} as Record<Page,string>)[page]}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose assigned site" onPress={()=>setSitePickerOpen(true)} style={styles.sitePill}>
          <Icon name="location-outline" size={17}/><Text style={styles.sitePillText} numberOfLines={1}>{scopeTitle}</Text><Icon name="chevron-down-outline" size={15}/>
        </Pressable>
      </View>}

      {siteStatus==='loading'?<ActivityIndicator color={GREEN} size="large" style={{marginVertical:36}}/>:
       siteStatus==='error'?<RecordCard><Text style={styles.error}>{error}</Text><Action label="Retry loading sites" onPress={()=>{void loadSites();}}/></RecordCard>:
       sites.length===0?<Empty message="No assigned sites are available for this account. Contact an administrator."/>:null}

      {contentReady?<>
        {!!error?<View style={styles.errorCard}><Icon name="alert-circle-outline" color={RED}/><Text style={[styles.error,{flex:1}]}>{error}</Text></View>:null}
        <View style={styles.refreshRow}>
          <Text style={styles.smallNote}>{statusLine} · Server records only</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh supervisor data" disabled={refreshing}
            onPress={()=>{void refresh();}} style={styles.refreshButton}>
            {refreshing?<ActivityIndicator color={GREEN} size="small"/>:<Icon name="refresh-outline" size={18}/>}
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        {page==='Home'&&<>
          <View style={styles.assignmentCard}>
            <View style={styles.assignmentHead}>
              <View style={styles.assignmentIcon}><Icon name="business-outline" size={28}/></View>
              <View style={{flex:1,gap:4}}>
                <Text style={styles.assignmentLabel}>Supervised locations</Text>
                <Text style={styles.assignmentTitle} numberOfLines={2}>{scopeTitle}</Text>
                <Text style={styles.assignmentSub}>{siteId===ALL_SITES?`${sites.length} assigned ${sites.length===1?'site':'sites'}`:selectedSite?.code??''}</Text>
              </View>
              <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Assigned</Text></View>
            </View>
            <View style={styles.metricStrip}>
              {[{name:'Sites',n:siteIds.length,icon:'business-outline' as IconName,color:GREEN},
                {name:'On duty',n:dutyGuards,icon:'people-outline' as IconName,color:GREEN},
                {name:'On break',n:breakGuards,icon:'cafe-outline' as IconName,color:'#AE781D'},
                {name:'Open cases',n:openCount,icon:'alert-circle-outline' as IconName,color:RED}
              ].map((metric,index)=><View key={metric.name} style={[styles.metricItem,index>0&&styles.metricDivider]}>
                <Icon name={metric.icon} color={metric.color} size={21}/>
                <Text style={styles.metricCount}>{stale?'—':metric.n}</Text>
                <Text style={styles.metricLabel}>{metric.name}</Text>
              </View>)}
            </View>
            <Text style={styles.limitNote}>Duty numbers: loaded active shifts (up to 200). Cases: latest 100 server incidents.</Text>
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="Review incidents awaiting acknowledgement"
            onPress={()=>navigate('Incidents')} style={({pressed})=>[styles.attentionBanner,{backgroundColor:awaiting>0?'#FFF0F0':'#EDF6F2'},pressed&&styles.pressed]}>
            <View style={[styles.attentionIcon,{backgroundColor:awaiting>0?RED:GREEN}]}>
              <Icon name={awaiting>0?'warning-outline':'checkmark-circle-outline'} color="#fff" size={26}/>
            </View>
            <View style={{flex:1,gap:4}}>
              <Text style={styles.bannerTitle}>{stale?'Awaiting incident status':awaiting>0?`${awaiting} ${awaiting===1?'incident needs':'incidents need'} acknowledgement`:'No new incidents awaiting review'}</Text>
              <Text style={styles.bannerBody}>Review server-received incident reports</Text>
            </View>
            <Icon name="chevron-forward-outline" size={20} color={awaiting>0?RED:GREEN}/>
          </Pressable>

          <Text style={styles.h2}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            <QuickAction title="Incident Inbox" subtitle="Review and acknowledge" icon="document-text-outline" color="#2677C9" bg="#EAF3FE" onPress={()=>navigate('Incidents')}/>
            <QuickAction title="Guards" subtitle="Duty status and invitations" icon="people-outline" color={GREEN} bg="#EAF4F0" onPress={()=>navigate('Guards')}/>
            <QuickAction title="Sites" subtitle="View assigned locations" icon="business-outline" color="#526576" bg="#F0F3F6" onPress={()=>navigate('Sites')}/>
            <QuickAction title="Shifts & Rosters" subtitle="View active shifts" icon="calendar-outline" color="#6674CC" bg="#F1F0FF" onPress={()=>navigate('Shifts')}/>
          </View>

          <View style={styles.spaceBetween}><Text style={styles.h2}>Recent Activity</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="View incident inbox" onPress={()=>navigate('Incidents')} style={styles.textButton}>
              <Text style={styles.textLink}>View All</Text><Icon name="chevron-forward-outline" size={16} color={GREEN}/>
            </Pressable>
          </View>
          {latestActivity.length===0?<Empty message={stale?'Waiting for server activity…':'No incidents or occurrence entries received in this scope.'}/>:
            <View style={styles.activityCard}>
              {latestActivity.map((a,index)=><Pressable key={`${a.kind}-${a.id}`} accessibilityRole="button" onPress={()=>a.incident?viewIncident(a.incident):navigate('OB')}
                style={({pressed})=>[styles.activityRow,index>0&&styles.activityDivider,pressed&&styles.pressed]}>
                <View style={[styles.activityIcon,{backgroundColor:a.kind==='incident'?'#FFF0F0':'#EAF4F0'}]}>
                  <Icon name={a.kind==='incident'?'alert-outline':'document-text-outline'} color={a.kind==='incident'?RED:GREEN} size={23}/>
                </View>
                <View style={{flex:1,gap:4}}><Text style={styles.activityTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.activitySubtitle} numberOfLines={2}>{a.subtitle} · {clockTime(a.when)}</Text></View>
                <Icon name="chevron-forward-outline" size={18} color={MUTED}/>
              </Pressable>)}
            </View>}

          <Text style={styles.h2}>Safety & Alerts</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View emergency procedures" onPress={()=>Alert.alert('Emergency procedures','Use approved emergency telephone/radio procedures for assistance. Automatic SOS and push alert delivery are not yet active in SmartOps.')}
            style={({pressed})=>[styles.attentionBanner,{backgroundColor:'#FFF0F0'},pressed&&styles.pressed]}>
            <View style={[styles.attentionIcon,{backgroundColor:RED}]}><Text style={styles.sos}>SOS</Text></View>
            <View style={{flex:1,gap:4}}><Text style={[styles.bannerTitle,{color:RED}]}>Emergency Procedures</Text>
              <Text style={styles.bannerBody}>Call or radio for assistance. Automatic SOS not yet active.</Text></View>
            <Icon name="chevron-forward-outline" color={RED}/>
          </Pressable>
          <Text style={styles.safetyNote}>Use established emergency procedures. In-app reporting does not dispatch assistance.</Text>
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
            {selected.status==='reported'&&<Action label={ackBusy?'Acknowledging…':'Acknowledge incident'}
              disabled={ackBusy||refreshing} onPress={()=>confirmAcknowledge(selected.id)}/>}
            <Text style={styles.muted}>Acknowledgement does not dispatch assistance. Use established emergency procedures.</Text>
          </RecordCard>
          <Text style={styles.heading}>Review history</Text>
          {detailError?<Text style={styles.error}>{detailError}</Text>:null}
          {updates.length===0?<Empty message="No supervisor updates recorded yet."/>:
            updates.map(u=><RecordCard key={u.id}><Text style={styles.heading}>{pretty(u.update_type)}</Text>
              <Text style={styles.paragraph}>{u.note}</Text><Text style={styles.muted}>{dateText(u.created_at)}</Text></RecordCard>)}
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
          <Text style={styles.muted}>Server-received occurrence entries · Latest 200 · {scopeTitle}</Text>
          {!ob.length?<Empty message="No occurrence entries received for these sites."/>:
            ob.map(o=><RecordCard key={o.id}>
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
  scroll:{flex:1},content:{paddingHorizontal:16,paddingTop:6,paddingBottom:28,gap:14},
  header:{paddingHorizontal:16,paddingVertical:13,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  brandRow:{flex:1,flexDirection:'row',alignItems:'center',gap:9},brandLogo:{height:40,width:39},
  brand:{fontSize:19,color:NAVY,flexShrink:1},brandBold:{fontWeight:'800'},
  headerAvatar:{width:43,height:43,borderRadius:24,backgroundColor:'#F0F3F5',alignItems:'center',justifyContent:'center'},
  greetingRow:{flexDirection:'row',alignItems:'center',gap:10,paddingTop:12,paddingBottom:4},
  greeting:{color:MUTED,fontSize:15},personName:{color:NAVY,fontSize:27,fontWeight:'800'},welcome:{color:MUTED,fontSize:13},
  sitePill:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'#F0F4F5',borderRadius:28,minHeight:44,paddingHorizontal:10,maxWidth:170},
  sitePillText:{fontSize:12,fontWeight:'600',color:GREEN,flexShrink:1},
  sectionHeader:{gap:12,paddingTop:12},
  h1:{fontSize:24,fontWeight:'800',color:NAVY},h2:{fontSize:21,fontWeight:'800',color:NAVY},
  heading:{fontSize:16,fontWeight:'700',color:NAVY},paragraph:{fontSize:14,lineHeight:21,color:NAVY},
  muted:{fontSize:12,lineHeight:19,color:MUTED},smallNote:{fontSize:11,lineHeight:16,color:MUTED,flex:1},
  kicker:{fontSize:11,fontWeight:'800',letterSpacing:.5,color:GREEN},
  error:{fontSize:13,fontWeight:'600',lineHeight:19,color:RED},errorCard:{padding:12,borderRadius:13,backgroundColor:'#fff2f2',flexDirection:'row',alignItems:'center',gap:10},
  refreshRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:6},refreshButton:{flexDirection:'row',alignItems:'center',gap:5,minHeight:36,paddingHorizontal:5},refreshText:{fontSize:12,color:GREEN,fontWeight:'700'},
  card:{borderRadius:16,borderWidth:1,borderColor:BORDER,backgroundColor:'#fff',padding:16,gap:10},
  status:{fontSize:12,fontWeight:'700',color:GREEN},urgent:{color:RED},
  spaceBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  action:{backgroundColor:GREEN,minHeight:48,paddingVertical:12,paddingHorizontal:15,borderRadius:12,alignItems:'center',justifyContent:'center'},
  actionSecondary:{backgroundColor:'#E9F2EF',borderWidth:1,borderColor:'#B7D4C9'},
  actionText:{color:'#fff',fontWeight:'700',fontSize:13},actionTextSecondary:{color:GREEN},
  assignmentCard:{backgroundColor:'#F1F5F5',borderRadius:18,paddingTop:17,paddingHorizontal:15,paddingBottom:14,borderLeftWidth:5,borderLeftColor:GREEN,gap:18},
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
  quickGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},quickAction:{width:'48%',flexGrow:1,minHeight:138,padding:12,borderRadius:18,flexDirection:'row',alignItems:'center',gap:8},
  quickIcon:{width:40,height:40,borderRadius:24,alignItems:'center',justifyContent:'center'},quickText:{flex:1,gap:5},quickTitle:{fontSize:14,fontWeight:'800',color:NAVY},quickSubtitle:{fontSize:11,lineHeight:16,color:MUTED},
  activityCard:{borderWidth:1,borderColor:BORDER,borderRadius:18,backgroundColor:'#fff',paddingHorizontal:13},
  activityRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,minHeight:81},activityDivider:{borderTopWidth:1,borderColor:BORDER},
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
