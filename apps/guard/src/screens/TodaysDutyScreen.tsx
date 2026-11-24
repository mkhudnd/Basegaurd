import React, {useEffect,useState} from 'react';
import {supabase} from '../api';
import {DutySummaryPanel,OperationalTaskRow} from '../OperationalMaterial';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet,
  Text, View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  BottomNavBar, COLORS, type DeliveryStatus, FONTS, HomeHeader, HomeHeaderControl,
  formatTimestamp, type GuardTabKey, InfoAlertBanner,
} from '../components';
import {
  breakDurationLabel,canChangeDutyPresence, dutyPresenceLabel, type DutyPresence,
} from '../duty-presence';

export interface VerifiedShiftContext {
  shiftId: string;
  post?:string|null;
  siteId: string;
  siteCode?: string;
  siteName: string;
  guardName: string;
  startedAt: string;
  endedAt?: string | null;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  /** Null when offline or not verified from the server. */
  presenceStatus?: DutyPresence | null;
  /** Server timestamp of the most recent confirmed presence change. */
  presenceUpdatedAt?: string | null;
}

export interface ActivitySummaryItem {
  id: string;
  recordType: 'incident' | 'occurrence';
  title: string;
  description: string;
  eventAt: string;
  siteName: string;
  deliveryStatus: DeliveryStatus;
  serverRef?: string | null;
}

export interface TodaysDutyScreenProps {
  guardId: string;
  todayCount:number;
  endDutyPending?:boolean;
  endDutyReceived?:boolean;
  profileName:string|null;
  successorAssigned:boolean;
  openIncidentCount:number|null;
  shiftContext: VerifiedShiftContext | null;
  isCachedDuty?: boolean;
  dutyError?: string | null;
  notice?: string | null;
  isLoadingShift?: boolean;
  isOnline: boolean;
  isUpdatingPresence?: boolean;
  pendingSyncCount: number;
  latestReceipt: string|null;
  failedSyncCount?: number;
  recentActivity: ActivitySummaryItem[];
  activeTab?: GuardTabKey;
  onSelectTab: (tab: GuardTabKey) => void;
  onReportIncident: () => void;
  onNewOccurrence: () => void;
  onOpenMyIncidents: () => void;
  onOpenSyncQueue: () => void;
  onOpenHandover: () => void;
  onSafetyProcedures: () => void;
  onChangePresence: (next: DutyPresence) => void | Promise<void>;
  onRequestOffDuty: () => void;
  onSelectActivityItem: (item: ActivitySummaryItem) => void;
  onRefreshShift?: () => void;
  onSignOut?: () => void;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Symbol({name,size=22,color=COLORS.primary}: {name:IconName;size?:number;color?:string}) {
  return <Ionicons name={name} size={size} color={color}/>;
}

function timeOnly(iso?:string|null) {
  if(!iso)return 'Ongoing';
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleTimeString('en-ZW',{hour:'2-digit',minute:'2-digit'}) : '—';
}


function ActivityItem({item,onPress}: {item:ActivitySummaryItem;onPress:()=>void}) {
  const isIncident = item.recordType==='incident';
  const icon:IconName = isIncident ? 'alert-circle-outline' : 'document-text-outline';
  return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed})=>[
    styles.activityRow,pressed&&styles.pressed,
  ]}>
    <View style={[styles.activityIcon,{backgroundColor:isIncident?'#FFF1F0':'#E7F2EE'}]}>
      <Symbol name={icon} color={isIncident?COLORS.danger:COLORS.primary} size={20}/>
    </View>
    <View style={styles.activityCopy}>
      <Text numberOfLines={1} style={styles.activityTitle}>{item.title}</Text>
      <Text numberOfLines={1} style={styles.activityDescription}>{item.description || item.siteName}</Text>
      <Text style={styles.activityStatus} numberOfLines={1}>{item.deliveryStatus==='received'?'Received by server':item.deliveryStatus==='queued'?'Pending sync':item.deliveryStatus==='failed'?'Sync failed':item.deliveryStatus.replace(/_/g,' ')}</Text>
    </View>
    <View style={styles.activityRight}>
      <Text style={styles.activityTime}>{timeOnly(item.eventAt)}</Text>
      <Symbol name="chevron-forward-outline" color={COLORS.textMuted} size={16}/>
    </View>
  </Pressable>;
}

export const TodaysDutyScreen:React.FC<TodaysDutyScreenProps> = ({
  guardId,todayCount,endDutyPending=false,endDutyReceived=false,profileName,successorAssigned,openIncidentCount,shiftContext,isCachedDuty=false,dutyError=null,notice=null,isLoadingShift=false,
  isOnline,isUpdatingPresence=false,pendingSyncCount,failedSyncCount=0,recentActivity,latestReceipt,
  activeTab='today',onSelectTab,onReportIncident,onNewOccurrence,onOpenMyIncidents,
  onOpenSyncQueue,onOpenHandover,onSafetyProcedures,onChangePresence,onRequestOffDuty,
  onSelectActivityItem,onRefreshShift,onSignOut,
}) => {
  const insets=useSafeAreaInsets();
  const [menuOpen,setMenuOpen]=useState(false);
  const [sheetMode,setSheetMode]=useState<'status'|'details'>('status');
  const [clockNow,setClockNow]=useState(()=>Date.now());
  useEffect(()=>{
    // Running only while the Today screen is mounted; no background sensor or tracking.
    const timer=setInterval(()=>setClockNow(Date.now()),30_000);
    return ()=>clearInterval(timer);
  },[]);
  const [scheduled,setScheduled]=useState<{id:string;guard:string;site:string;post?:string;start:string}|null>(null);
  useEffect(()=>{
    let current=true;
    setScheduled(null);
    if(isOnline && !shiftContext && !isLoadingShift){
      const now=new Date().toISOString();
      void supabase.from('shifts').select('*,sites(name)').eq('guard_id',guardId)
        .eq('status','scheduled').or('ended_at.is.null,ended_at.gt.'+now)
        .order('started_at').limit(1).maybeSingle().then(({data})=>{
          if(current && data){
            const site=Array.isArray(data.sites)?data.sites[0]:data.sites;
            setScheduled({id:data.id,guard:guardId,site:site?.name??'Assigned site',post:data.post,start:data.started_at});
          }
        });
    }
    return ()=>{current=false;};
  },[guardId,isOnline,isLoadingShift,shiftContext?.shiftId]);
  const nextShift=isOnline && scheduled?.guard===guardId?scheduled:null;
  const totalUnsent=pendingSyncCount+failedSyncCount;
  const presence: DutyPresence|null = !isCachedDuty ? (shiftContext?.presenceStatus??null) : null;
  const canChange = canChangeDutyPresence({shiftId:shiftContext?.shiftId,isOnline,isCachedDuty,isBusy:isUpdatingPresence||endDutyPending||endDutyReceived});
  const statusLabel = !shiftContext?'No Shift':dutyPresenceLabel(presence);
  const onBreak=presence==='on_break';
  const breakStartedAt=onBreak?shiftContext?.presenceUpdatedAt:null;
  const breakDuration=onBreak?breakDurationLabel(breakStartedAt,clockNow):null;
  const dotColor = presence==='on_duty'?COLORS.success:onBreak?COLORS.warning:COLORS.textMuted;
  const [firstName] = (profileName || shiftContext?.guardName || 'Officer').split(/\s+/);
  const choosePresence=(next:DutyPresence)=>{
    setMenuOpen(false);
    if(next!==presence && canChange)void onChangePresence(next);
  };

  return <View style={[styles.root,{backgroundColor:COLORS.background}]}>
    <HomeHeader
      greeting={new Date().getHours()<12?'Good morning':new Date().getHours()<18?'Good afternoon':'Good evening'}
      name={firstName}
      heading="Current duty"
      subtitle={shiftContext?.siteName??nextShift?.site??'Guard workspace'}
      brandAction={<HomeHeaderControl kind="icon" accessibilityLabel="View shift details"
        onPress={()=>{setSheetMode('details');setMenuOpen(true);}}>
        <View style={{width:32,height:32,borderRadius:16,backgroundColor:'#285748',alignItems:'center',justifyContent:'center'}}>
          <Text style={{color:'white',fontWeight:'700',fontSize:12}}>{(shiftContext?.guardName||'Guard').trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}</Text>
        </View>
      </HomeHeaderControl>}
    />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      {dutyError?<InfoAlertBanner tone="danger" title="Duty status needs attention" body={dutyError}/>:null}
      {notice?<InfoAlertBanner tone="warning" title="Action needs attention" body={notice}/>:null}
      {endDutyPending?<InfoAlertBanner tone="offline" title="End duty waiting for server" body="The end-duty request is saved on this phone. Open End duty to review or retry."/>:null}
      {endDutyReceived?<InfoAlertBanner tone="success" title="End duty received" body="The server has recorded the end of this shift. Refresh to load your current assignment."/>:null}

      <DutySummaryPanel
        post={shiftContext?.post??nextShift?.post??'Post not recorded'}
        site={shiftContext?.siteName??nextShift?.site??(isLoadingShift?'Checking assignment…':'No active assignment')}
        status={shiftContext?(isCachedDuty?'Cached duty':statusLabel):'Off duty'}
        start={shiftContext?timeOnly(shiftContext.startedAt):nextShift?timeOnly(nextShift.start):'—'}
        scheduledEnd={shiftContext?.endedAt?timeOnly(shiftContext.endedAt):'Not recorded'}
        actionLabel={shiftContext?(endDutyPending||endDutyReceived?'Review End Duty':'View shift / End Duty'):'Start duty'}
        actionDisabled={!shiftContext&&(!nextShift||!isOnline||Date.parse(nextShift.start)>Date.now())}
        notice={successorAssigned?'Relief is assigned. Incoming guard acceptance is verified separately.':undefined}
        onAction={async()=>{
          if(shiftContext){onRequestOffDuty();return;}
          if(nextShift){
            const {error}=await supabase.rpc('start_guard_duty',{p_shift_id:nextShift.id});
            if(error)Alert.alert('Duty start failed',error.message);
            else onRefreshShift?.();
          }
        }}
      />

      {onBreak?<View style={styles.breakNotice} accessibilityRole="text">
        <View style={styles.breakNoticeIcon}><Symbol name="cafe-outline" size={21} color={COLORS.warning}/></View>
        <View style={styles.breakNoticeCopy}>
          <Text style={styles.breakNoticeTitle}>Break in progress</Text>
          <Text style={styles.breakNoticeDescription}>{breakStartedAt?`Started ${timeOnly(breakStartedAt)}${breakDuration?` · ${breakDuration}`:''}`:'Break confirmed; time unavailable'}{!isOnline?' · Offline':''}</Text>
        </View>
        <Pressable onPress={()=>choosePresence('on_duty')} accessibilityRole="button" disabled={!canChange}
          accessibilityState={{disabled:!canChange}} style={[styles.resumeButton,!canChange&&styles.disabled]}>
          <Text style={styles.resumeText}>Resume</Text>
        </Pressable>
      </View>:null}

      <Pressable accessibilityRole="button" onPress={onOpenSyncQueue} style={({pressed})=>[
        styles.syncStrip,{backgroundColor:isOnline?'#E8F3ED':'#FFF0DB'},pressed&&styles.pressed,
      ]}>
        <View style={styles.syncIcon}><Symbol name={totalUnsent?'cloud-upload-outline':'cloud-done-outline'} size={24} color={totalUnsent?COLORS.warning:COLORS.success}/></View>
        <View style={styles.syncCopy}>
          <Text style={styles.syncTitle}>{!isOnline?`Offline · ${pendingSyncCount} queued${failedSyncCount ? ' · '+failedSyncCount+' failed' : ''}`:failedSyncCount?`${failedSyncCount} sync failed`:
            totalUnsent?`${totalUnsent} pending sync`:isLoadingShift?'Checking outbox…':latestReceipt?'All records synced':'No unsent local reports'}</Text>
          <Text style={styles.syncSub} numberOfLines={2}>{totalUnsent?
            'Saved on this device. Tap to see the queue.':latestReceipt?'Last receipt at '+timeOnly(latestReceipt):'View sync queue'}
          </Text>
        </View>
        <Symbol name="chevron-forward-outline" color={COLORS.navy} size={20}/>
      </Pressable>

      <View style={{marginTop:16,marginBottom:8}}>
        <Text style={{fontFamily:FONTS.bold,fontSize:18,fontWeight:'700',color:COLORS.text}}>Actions</Text>
        <Text style={{fontFamily:FONTS.regular,fontSize:12,color:COLORS.textMuted,marginTop:3}}>Today’s log · {todayCount} entries · Open reports in history {openIncidentCount??'—'}</Text>
      </View>
      <OperationalTaskRow title="New OB entry" description={shiftContext?'Log an occurrence or observation':'Start duty to log'}
        icon="document-text-outline" disabled={!shiftContext||endDutyPending||endDutyReceived} onPress={onNewOccurrence}/>
      <OperationalTaskRow title="Report incident" description={shiftContext?'Document a security concern':'Start duty to report'}
        icon="alert-circle-outline" disabled={!shiftContext||endDutyPending||endDutyReceived} onPress={onReportIncident}/>
      <OperationalTaskRow title="Shift handover" description="Review outgoing and incoming shift records"
        icon="swap-horizontal-outline" onPress={onOpenHandover}/>
      <OperationalTaskRow title="Emergency procedures" description="Use approved control room telephone or radio"
        icon="call-outline" danger onPress={onSafetyProcedures}/>

      <View style={[styles.sectionHeader, {marginTop: 16}]}>
        <Text style={{fontFamily:FONTS.bold,fontWeight:'700',fontSize:18,color:COLORS.text,marginBottom:8}}>Recent activity</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open occurrence book" onPress={()=>onSelectTab('ob')}>
          <Text style={styles.seeAll}>Occurrence Book <Symbol name="chevron-forward" size={14} color={COLORS.textMuted}/></Text>
        </Pressable>
      </View>
      <View style={styles.activityContainer}>
        {recentActivity.length ? recentActivity.slice(0,3).map(item=>
          <ActivityItem key={item.id} item={item} onPress={()=>onSelectActivityItem(item)}/>) :
          <View style={styles.emptyActivity}><Symbol name="time-outline" color={COLORS.textMuted}/>
            <Text style={styles.emptyText}>{isLoadingShift?'Loading activity…':'No entries for this shift yet.'}</Text>
          </View>}
      </View>

    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="Open emergency procedures"
      onPress={onSafetyProcedures}
      style={{marginHorizontal:16,marginVertical:8,minHeight:48,justifyContent:'center',backgroundColor:'#FFF5F3',borderWidth:1,borderColor:'#EFCBC5',borderRadius:12,padding:10}}>
      <Text style={{textAlign:'center',color:COLORS.danger,fontWeight:'700',fontSize:14}}>Emergency procedures</Text>
      <Text style={{textAlign:'center',color:COLORS.textMuted,fontSize:12,marginTop:3}}>Use approved telephone or radio channels</Text>
    </Pressable>

    <BottomNavBar activeTab={activeTab} onSelectTab={onSelectTab} unsyncedCount={totalUnsent}/>

    <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={()=>setMenuOpen(false)} statusBarTranslucent>
      <View style={styles.sheetShade}>
        <Pressable style={StyleSheet.absoluteFillObject} accessibilityRole="button"
          accessibilityLabel="Close duty controls" onPress={()=>setMenuOpen(false)}/>
        <View style={[styles.dutySheet,{paddingBottom:Math.max(insets.bottom,12)+12}]}>
          <View style={styles.sheetHandle}/>
          <View style={styles.sheetHeading}>
            <View style={{flex:1}}>
              <Text style={styles.sheetTitle}>{sheetMode==='status'?'Duty status':'Shift Details'}</Text>
              <Text style={styles.sheetSubtitle} numberOfLines={1}>{shiftContext?.siteName??'No active assignment'}</Text>
            </View>
            <Pressable onPress={()=>setMenuOpen(false)} accessibilityRole="button" accessibilityLabel="Close duty controls" style={styles.closeButton}>
              <Symbol name="close" color={COLORS.navy} size={22}/>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false} bounces={false}>
            {sheetMode==='status'?<>
            <Pressable accessibilityRole="button" accessibilityState={{selected:presence==='on_duty',disabled:!canChange||presence==='on_duty'}}
              disabled={!canChange||presence==='on_duty'} onPress={()=>choosePresence('on_duty')}
              style={[styles.sheetOption,presence==='on_duty'&&styles.sheetSelected]}>
              <View style={[styles.sheetIcon,{backgroundColor:'#E6F3EC'}]}><Symbol name="shield-checkmark-outline" color={COLORS.success} size={22}/></View>
              <View style={styles.menuCopy}><Text style={styles.optionTitle}>On Duty</Text>
                <Text numberOfLines={2} style={styles.optionDescription}>At your assigned post</Text></View>
              {presence==='on_duty'?<Symbol name="checkmark-circle" color={COLORS.success} size={22}/>:null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{selected:onBreak,disabled:!canChange||onBreak}}
              disabled={!canChange||onBreak} onPress={()=>choosePresence('on_break')}
              style={[styles.sheetOption,onBreak&&styles.sheetSelectedBreak]}>
              <View style={[styles.sheetIcon,{backgroundColor:'#FFF1D5'}]}><Symbol name="cafe-outline" color={COLORS.warning} size={22}/></View>
              <View style={styles.menuCopy}><Text style={styles.optionTitle}>On Break</Text>
                <Text numberOfLines={2} style={styles.optionDescription}>{onBreak&&breakDuration?`Started ${timeOnly(breakStartedAt)} · ${breakDuration}`:'Temporarily unavailable'}</Text></View>
              {onBreak?<Symbol name="checkmark-circle" color={COLORS.warning} size={22}/>:null}
            </Pressable>
            <Pressable accessibilityRole="button" onPress={()=>{setMenuOpen(false);onRequestOffDuty();}}
              style={styles.sheetOption}>
              <View style={[styles.sheetIcon,{backgroundColor:'#EEF2F4'}]}><Symbol name="log-out-outline" color={COLORS.textMuted} size={22}/></View>
              <View style={styles.menuCopy}><Text style={styles.optionTitle}>Off Duty / Handover</Text>
                <Text numberOfLines={2} style={styles.optionDescription}>Prepare handover; shift stays active</Text></View>
              <Symbol name="chevron-forward" color={COLORS.textMuted} size={17}/>
            </Pressable>
            <View style={styles.sheetDivider}/>
            <Pressable accessibilityRole="button" onPress={()=>setSheetMode('details')}
              style={styles.sheetOption}>
              <View style={[styles.sheetIcon,{backgroundColor:'#E7F2EE'}]}><Symbol name="information-circle-outline" color={COLORS.primary} size={22}/></View>
              <View style={styles.menuCopy}><Text style={styles.optionTitle}>View Shift Details</Text>
                <Text style={styles.optionDescription}>Assignment, start time and status</Text></View>
              <Symbol name="chevron-forward" color={COLORS.textMuted} size={17}/>
            </Pressable>
            </>:<View style={styles.sheetDetailBody}>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Site</Text>
            <Text style={styles.detailValue}>{shiftContext?.siteName??'Not assigned'}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Duty status</Text>
            <Text style={styles.detailValue}>{statusLabel}</Text></View>
          {onBreak?<View style={styles.detailLine}><Text style={styles.detailLabel}>Break started</Text>
            <Text style={styles.detailValue}>{breakStartedAt?formatTimestamp(breakStartedAt):'Server time unavailable'}{breakDuration?` (${breakDuration})`:''}</Text></View>:null}
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Shift started</Text>
            <Text style={styles.detailValue}>{formatTimestamp(shiftContext?.startedAt)}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Shift end</Text>
            <Text style={styles.detailValue}>{shiftContext?.endedAt?formatTimestamp(shiftContext.endedAt):'Not scheduled'}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Shift ID</Text>
            <Text selectable style={styles.detailValue}>{shiftContext?.shiftId??'—'}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Connection</Text>
            <Text style={styles.detailValue}>{isOnline?'Online':'Offline — status last confirmed'}</Text></View>
          {onRefreshShift?<Pressable onPress={()=>{setMenuOpen(false);onRefreshShift();}} style={styles.refreshButton}>
            <Symbol name="refresh-outline" size={19} color={COLORS.white}/><Text style={styles.refreshLabel}>Refresh Shift</Text>
          </Pressable>:null}
          {onSignOut?<Pressable onPress={()=>{setMenuOpen(false);onSignOut();}} style={styles.signOutButton}>
            <Symbol name="log-out-outline" color={COLORS.navy}/><Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>:null}
            </View>}
          </ScrollView>
          {!canChange&&sheetMode==='status'?<Text style={styles.sheetFootnote}>Online connection and a server-verified active shift are required to change status.</Text>:null}
        </View>
      </View>
    </Modal>

  </View>;
};

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:COLORS.surface},
  dutyPillLabel:{fontFamily:FONTS.medium,color:COLORS.primary,fontSize:12,fontWeight:'600'},
  dutyPillBreak:{backgroundColor:'#FFF0D4'},dutyPillBreakText:{color:COLORS.warning},
  statusDot:{height:10,width:10,borderRadius:5},
  headerAction:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:24},
  scroll:{flex:1},scrollBody:{paddingHorizontal:16,paddingTop:12,paddingBottom:24},
  assignmentCard:{backgroundColor:'#F3F6F6',borderLeftWidth:4,borderLeftColor:COLORS.primary,borderRadius:14,padding:15,marginBottom:10},
  assignmentCardOnBreak:{borderLeftColor:COLORS.warning,backgroundColor:'#FAF8F2'},
  assignmentHead:{flexDirection:'row',gap:9,alignItems:'center'},
  assignmentIcon:{width:43,height:43,borderRadius:22,backgroundColor:'#E7EFEF',alignItems:'center',justifyContent:'center'},
  assignmentNameBlock:{flex:1,minWidth:0},label:{color:COLORS.textMuted,fontSize:12,fontFamily:FONTS.regular},
  siteName:{color:COLORS.navy,fontFamily:FONTS.bold,fontWeight:'700',fontSize:18,lineHeight:25},
  activeTag:{backgroundColor:'#D9F3E3',borderRadius:8,paddingHorizontal:8,paddingVertical:6,alignSelf:'flex-start'},
  activeTagText:{color:COLORS.primary,fontSize:11,fontFamily:FONTS.bold,fontWeight:'700'},
  activeTagOnBreak:{backgroundColor:'#FFF0D4'},activeTagTextOnBreak:{color:COLORS.warning},
  assignmentFacts:{flexDirection:'row',alignItems:'stretch',marginTop:14},
  fact:{flex:1,alignItems:'center',gap:3,minWidth:0},factMiddle:{borderLeftWidth:1,borderRightWidth:1,borderColor:COLORS.border},
  factLabel:{color:COLORS.textMuted,fontFamily:FONTS.regular,fontSize:11},
  factValue:{color:COLORS.navy,fontFamily:FONTS.bold,fontWeight:'700',fontSize:12},
  noDutyNote:{color:COLORS.textMuted,fontSize:13,lineHeight:20,marginTop:12},cachedNote:{color:COLORS.offline,fontSize:12,marginTop:10},
  breakNotice:{flexDirection:'row',gap:9,alignItems:'center',backgroundColor:'#FFF5E1',borderColor:'#E5C68E',borderWidth:1,borderRadius:13,padding:10,marginBottom:11},
  breakNoticeIcon:{width:39,height:39,borderRadius:20,backgroundColor:'#FFE8B7',alignItems:'center',justifyContent:'center'},
  breakNoticeCopy:{flex:1,minWidth:0},breakNoticeTitle:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:13,color:COLORS.warning},
  breakNoticeDescription:{fontFamily:FONTS.regular,fontSize:11,color:COLORS.textMuted,marginTop:2},
  resumeButton:{borderRadius:9,backgroundColor:COLORS.primary,paddingHorizontal:11,paddingVertical:10,minHeight:42,justifyContent:'center'},
  resumeText:{color:COLORS.white,fontFamily:FONTS.bold,fontWeight:'700',fontSize:12},
  syncStrip:{flexDirection:'row',alignItems:'center',borderRadius:10,padding:8,gap:8,marginBottom:10,minHeight:48},
  syncIcon:{width:28,alignItems:'center',justifyContent:'center'},
  syncCopy:{flex:1},syncTitle:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:14,color:COLORS.navy},
  syncSub:{fontFamily:FONTS.regular,fontSize:11,color:COLORS.textMuted,lineHeight:16,marginTop:2},
  quickSubtitle:{fontSize:10,color:COLORS.textMuted,fontFamily:FONTS.regular,lineHeight:14},
  sectionHeader:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',gap:6},
  seeAll:{color:COLORS.textMuted,fontSize:11,fontFamily:FONTS.regular},
  activityContainer:{borderWidth:1,borderColor:COLORS.border,borderRadius:14,backgroundColor:COLORS.surface,overflow:'hidden',marginBottom:22},
  activityRow:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:12,minHeight:72,borderBottomColor:'#EBEFF1',borderBottomWidth:1,gap:10},
  activityIcon:{width:38,height:38,borderRadius:20,alignItems:'center',justifyContent:'center'},
  activityCopy:{flex:1,minWidth:0},activityTitle:{fontSize:13,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.navy},
  activityDescription:{fontSize:12,color:COLORS.textMuted,marginTop:2},activityStatus:{fontSize:10,color:COLORS.textMuted,marginTop:3,textTransform:'capitalize'},
  activityRight:{flexDirection:'row',gap:6,alignItems:'center'},activityTime:{fontSize:11,color:COLORS.textMuted},
  emptyActivity:{flexDirection:'row',alignItems:'center',padding:16,gap:10},emptyText:{fontSize:12,color:COLORS.textMuted,flex:1},
  safetyCard:{backgroundColor:'#FFF0F0',borderRadius:14,flexDirection:'row',alignItems:'center',padding:13,gap:10,minHeight:80},
  sosSymbol:{backgroundColor:'#DC3838',width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center'},
  sosText:{fontSize:15,color:COLORS.white,fontFamily:FONTS.bold,fontWeight:'700'},
  safetyCopy:{flex:1,gap:4},safetyTitle:{color:COLORS.danger,fontSize:14,fontWeight:'700',fontFamily:FONTS.bold},
  safetySub:{color:COLORS.textMuted,fontSize:11,lineHeight:15},safetyReminder:{fontSize:11,lineHeight:16,color:COLORS.textMuted,marginTop:9},
  pressed:{opacity:.76},disabled:{opacity:.5},
  sheetShade:{flex:1,justifyContent:'flex-end',backgroundColor:'#10212DB0'},
  dutySheet:{backgroundColor:COLORS.white,borderTopLeftRadius:23,borderTopRightRadius:23,paddingHorizontal:17,paddingTop:9,
    maxHeight:'82%',elevation:14,shadowColor:COLORS.navy,shadowOpacity:.2,shadowRadius:15},
  sheetHandle:{height:5,width:40,borderRadius:5,backgroundColor:'#D4DDE1',alignSelf:'center',marginBottom:13},
  sheetHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:9},
  sheetTitle:{color:COLORS.navy,fontFamily:FONTS.bold,fontWeight:'700',fontSize:19},
  sheetSubtitle:{color:COLORS.textMuted,fontFamily:FONTS.regular,fontSize:11,marginTop:3},
  sheetScroll:{flexGrow:0},sheetDetailBody:{paddingTop:2,paddingBottom:2},
  sheetOption:{flexDirection:'row',alignItems:'center',minHeight:64,paddingHorizontal:9,paddingVertical:7,borderRadius:12,gap:12},
  sheetSelected:{backgroundColor:'#EDF6F2'},sheetSelectedBreak:{backgroundColor:'#FFF7E8'},
  sheetIcon:{width:38,height:38,borderRadius:19,alignItems:'center',justifyContent:'center'},
  menuCopy:{flex:1,minWidth:0},optionTitle:{fontSize:13,color:COLORS.navy,fontFamily:FONTS.bold,fontWeight:'700'},
  optionDescription:{fontSize:11,lineHeight:16,color:COLORS.textMuted,marginTop:3},
  sheetDivider:{height:1,backgroundColor:COLORS.border,marginVertical:6},
  sheetFootnote:{fontSize:11,color:COLORS.offline,marginHorizontal:8,marginTop:8,lineHeight:16},
  detailsShade:{flex:1,justifyContent:'flex-end',backgroundColor:'#0007'},detailsCard:{backgroundColor:COLORS.surface,borderTopLeftRadius:20,borderTopRightRadius:20,padding:20},
  detailsHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:15},
  detailsTitle:{fontSize:19,fontFamily:FONTS.bold,color:COLORS.navy,fontWeight:'700'},closeButton:{padding:7},
  detailLine:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:COLORS.border,flexDirection:'row',justifyContent:'space-between',gap:12},
  detailLabel:{fontSize:12,color:COLORS.textMuted,maxWidth:'32%'},detailValue:{fontSize:12,color:COLORS.navy,fontFamily:FONTS.medium,flex:1,textAlign:'right'},
  refreshButton:{backgroundColor:COLORS.primary,padding:14,borderRadius:11,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:8,marginTop:22,minHeight:48},
  refreshLabel:{color:COLORS.white,fontFamily:FONTS.bold,fontWeight:'700'},
  signOutButton:{flexDirection:'row',gap:10,justifyContent:'center',alignItems:'center',marginTop:12,minHeight:48},
  signOutLabel:{color:COLORS.navy,fontFamily:FONTS.bold,fontWeight:'700',fontSize:14},
});
