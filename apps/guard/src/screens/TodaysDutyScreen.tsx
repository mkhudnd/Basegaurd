import React, {useEffect,useState} from 'react';
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet,
  Text, View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  BottomNavBar, COLORS, type DeliveryStatus, FONTS,
  formatTimestamp, type GuardTabKey, InfoAlertBanner,
} from '../components';
import {
  breakDurationLabel,canChangeDutyPresence, dutyPresenceLabel, type DutyPresence,
} from '../duty-presence';

export interface VerifiedShiftContext {
  shiftId: string;
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
  shiftContext: VerifiedShiftContext | null;
  isCachedDuty?: boolean;
  dutyError?: string | null;
  notice?: string | null;
  isLoadingShift?: boolean;
  isOnline: boolean;
  isUpdatingPresence?: boolean;
  pendingSyncCount: number;
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

function QuickAction({title,subtitle,name,tone,onPress,disabled=false}: {
  title:string;subtitle:string;name:IconName;tone:'green'|'red'|'blue'|'slate';onPress:()=>void;disabled?:boolean;
}) {
  const meta = {
    green:{color:COLORS.primary,bg:'#EDF6F2'},
    red:{color:COLORS.danger,bg:'#FFF1F0'},
    blue:{color:'#2374C6',bg:'#ECF5FF'},
    slate:{color:'#536576',bg:'#F0F3F5'},
  }[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[styles.quickAction,{backgroundColor:meta.bg},disabled&&styles.disabled,pressed&&styles.pressed]}>
    <View style={[styles.quickIcon,{backgroundColor:meta.color}]}>
      <Symbol name={name} color={COLORS.white} size={23}/>
    </View>
    <View style={styles.quickCopy}>
      <Text numberOfLines={1} style={styles.quickTitle}>{title}</Text>
      <Text numberOfLines={2} style={styles.quickSubtitle}>{subtitle}</Text>
    </View>
    <Symbol name="chevron-forward-outline" color={COLORS.textMuted} size={16}/>
  </Pressable>;
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
  shiftContext,isCachedDuty=false,dutyError=null,notice=null,isLoadingShift=false,
  isOnline,isUpdatingPresence=false,pendingSyncCount,failedSyncCount=0,recentActivity,
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
  const totalUnsent=pendingSyncCount+failedSyncCount;
  const presence: DutyPresence|null = !isCachedDuty ? (shiftContext?.presenceStatus??null) : null;
  const canChange = canChangeDutyPresence({shiftId:shiftContext?.shiftId,isOnline,isCachedDuty,isBusy:isUpdatingPresence});
  const statusLabel = !shiftContext?'No Shift':dutyPresenceLabel(presence);
  const onBreak=presence==='on_break';
  const breakStartedAt=onBreak?shiftContext?.presenceUpdatedAt:null;
  const breakDuration=onBreak?breakDurationLabel(breakStartedAt,clockNow):null;
  const dotColor = presence==='on_duty'?COLORS.success:onBreak?COLORS.warning:COLORS.textMuted;
  const [firstName] = (shiftContext?.guardName || 'Officer').split(/\s+/);
  const choosePresence=(next:DutyPresence)=>{
    setMenuOpen(false);
    if(next!==presence && canChange)void onChangePresence(next);
  };

  return <View style={styles.root}>
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require('../../assets/brand-shield.png')} resizeMode="contain" style={styles.logo}/>
        <Text numberOfLines={1} style={styles.brandName}><Text style={styles.brandHeavy}>Baseguard </Text>SmartOps</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Duty status: ${statusLabel}. Open duty controls`}
        accessibilityState={{expanded:menuOpen}} onPress={()=>{setSheetMode('status');setMenuOpen(true);}}
        style={({pressed})=>[styles.dutyPill,onBreak&&styles.dutyPillBreak,pressed&&styles.pressed]}>
        {isUpdatingPresence?<ActivityIndicator size="small" color={COLORS.primary}/>:<View style={[styles.statusDot,{backgroundColor:dotColor}]}/>}
        <Text style={[styles.dutyPillLabel,onBreak&&styles.dutyPillBreakText]} numberOfLines={1}>{isUpdatingPresence?'Updating…':statusLabel}</Text>
        <Symbol name="chevron-down-outline" color={COLORS.primary} size={17}/>
      </Pressable>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      <View style={styles.greetingRow}>
        <View style={styles.greetingText}>
          <Text style={styles.greeting}>Good day, Officer</Text>
          <Text style={styles.personName} numberOfLines={1}>{firstName}</Text>
          <Text style={styles.welcomeNote}>Stay alert. Stay safe.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="View shift details"
          onPress={()=>{setSheetMode('details');setMenuOpen(true);}} style={styles.avatar}>
          <Symbol name="person-outline" color={COLORS.navy} size={24}/>
        </Pressable>
      </View>

      {dutyError?<InfoAlertBanner tone="danger" title="Duty status needs attention" body={dutyError}/>:null}
      {notice?<InfoAlertBanner tone="warning" title="Action needs attention" body={notice}/>:null}

      <View style={[styles.assignmentCard,onBreak&&styles.assignmentCardOnBreak]}>
        <View style={styles.assignmentHead}>
          <View style={styles.assignmentIcon}><Symbol name="business-outline" size={24} color={COLORS.navy}/></View>
          <View style={styles.assignmentNameBlock}>
            <Text style={styles.label}>Current Assignment</Text>
            <Text style={styles.siteName} numberOfLines={2}>
              {shiftContext?.siteName??(isLoadingShift?'Loading assignment…':'No active assignment')}
            </Text>
          </View>
          {shiftContext?<View style={[styles.activeTag,onBreak&&styles.activeTagOnBreak]}><Text style={[styles.activeTagText,onBreak&&styles.activeTagTextOnBreak]}>Active Shift</Text></View>:null}
        </View>
        {shiftContext?<View style={styles.assignmentFacts}>
          <View style={styles.fact}>
            <Symbol name="calendar-outline" size={19} color={COLORS.primary}/>
            <Text style={styles.factLabel}>Shift</Text>
            <Text style={styles.factValue} numberOfLines={1}>Active</Text>
          </View>
          <View style={[styles.fact,styles.factMiddle]}>
            <Symbol name="time-outline" size={19} color={COLORS.primary}/>
            <Text style={styles.factLabel}>Started</Text>
            <Text style={styles.factValue}>{timeOnly(shiftContext.startedAt)}</Text>
          </View>
          <View style={styles.fact}>
            <Symbol name="location-outline" size={19} color={COLORS.primary}/>
            <Text style={styles.factLabel}>Ends</Text>
            <Text style={styles.factValue}>{timeOnly(shiftContext.endedAt)}</Text>
          </View>
        </View>:<Text style={styles.noDutyNote}>
          {isLoadingShift?'Checking your assigned shift.':'An authorized active shift is required to record incidents and OB entries.'}
        </Text>}
        {isCachedDuty?<Text style={styles.cachedNote}>Offline: assignment last verified on this device. Duty presence cannot be changed.</Text>:null}
      </View>

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
        styles.syncStrip,pressed&&styles.pressed,
      ]}>
        <View style={styles.syncIcon}><Symbol name={totalUnsent?'cloud-upload-outline':'cloud-done-outline'} size={24} color={totalUnsent?COLORS.warning:COLORS.success}/></View>
        <View style={styles.syncCopy}>
          <Text style={styles.syncTitle}>{failedSyncCount?`${failedSyncCount} sync failed`:
            totalUnsent?`${totalUnsent} pending sync`:'No unsent local reports'}</Text>
          <Text style={styles.syncSub} numberOfLines={2}>{totalUnsent?
            'Reports not yet received by the supervisor':'This device’s encrypted outbox is clear'}
            {!isOnline?' · Offline':''}
          </Text>
        </View>
        <Symbol name="chevron-forward-outline" color={COLORS.navy} size={20}/>
      </Pressable>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionGrid}>
        <QuickAction title="New OB Entry" subtitle="Log patrols, visitors, etc." name="document-text-outline"
          tone="green" disabled={!shiftContext} onPress={onNewOccurrence}/>
        <QuickAction title="Report Incident" subtitle="Security, safety or other" name="warning-outline"
          tone="red" disabled={!shiftContext} onPress={onReportIncident}/>
        <QuickAction title="My Incidents" subtitle="View reported incidents" name="reader-outline"
          tone="blue" onPress={onOpenMyIncidents}/>
        <QuickAction title="Handover" subtitle="Incoming / outgoing shift" name="people-outline"
          tone="slate" onPress={onOpenHandover}/>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open occurrence book" onPress={()=>onSelectTab('ob')}>
          <Text style={styles.seeAll}>Occurrence Book <Symbol name="chevron-forward" size={14} color={COLORS.textMuted}/></Text>
        </Pressable>
      </View>
      <View style={styles.activityContainer}>
        {recentActivity.length ? recentActivity.slice(0,3).map(item=>
          <ActivityItem key={item.id} item={item} onPress={()=>onSelectActivityItem(item)}/>) :
          <View style={styles.emptyActivity}><Symbol name="time-outline" color={COLORS.textMuted}/>
            <Text style={styles.emptyText}>No incident or OB activity recorded on this phone yet.</Text>
          </View>}
      </View>

      <Text style={styles.sectionTitle}>Safety</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Read emergency procedures" onPress={onSafetyProcedures}
        style={({pressed})=>[styles.safetyCard,pressed&&styles.pressed]}>
        <View style={styles.sosSymbol}><Text style={styles.sosText}>SOS</Text></View>
        <View style={styles.safetyCopy}>
          <Text style={styles.safetyTitle}>Emergency Procedures</Text>
          <Text style={styles.safetySub}>Call or radio for assistance. Automatic SOS is not yet active.</Text>
        </View>
        <Symbol name="chevron-forward-outline" size={20} color={COLORS.danger}/>
      </Pressable>
      <Text style={styles.safetyReminder}>Use approved emergency telephone/radio procedures. In-app reporting does not dispatch assistance.</Text>
    </ScrollView>
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
  header:{minHeight:62,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,backgroundColor:COLORS.surface},
  brandRow:{flexDirection:'row',alignItems:'center',flex:1,minWidth:0,gap:6},
  logo:{width:36,height:39},brandName:{fontSize:18,fontFamily:FONTS.regular,color:COLORS.navy,flexShrink:1},
  brandHeavy:{fontFamily:FONTS.bold,fontWeight:'700'},
  dutyPill:{flexDirection:'row',minHeight:44,alignItems:'center',gap:7,paddingHorizontal:11,borderRadius:18,backgroundColor:'#F2F5F6',maxWidth:160},
  dutyPillLabel:{fontFamily:FONTS.medium,color:COLORS.primary,fontSize:12,fontWeight:'600'},
  dutyPillBreak:{backgroundColor:'#FFF0D4'},dutyPillBreakText:{color:COLORS.warning},
  statusDot:{height:10,width:10,borderRadius:5},
  scroll:{flex:1},scrollBody:{paddingHorizontal:16,paddingBottom:24},
  greetingRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:9,marginBottom:17},
  greetingText:{flex:1,minWidth:0},greeting:{fontFamily:FONTS.regular,fontSize:14,color:COLORS.textMuted},
  personName:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:26,color:COLORS.navy,lineHeight:34},
  welcomeNote:{fontSize:13,color:COLORS.textMuted,fontFamily:FONTS.regular},
  avatar:{height:46,width:46,backgroundColor:'#EDF1F3',borderRadius:23,alignItems:'center',justifyContent:'center'},
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
  syncStrip:{flexDirection:'row',alignItems:'center',backgroundColor:'#F5F7F8',borderRadius:13,padding:12,gap:12,marginBottom:20,minHeight:69},
  syncIcon:{width:43,height:43,borderRadius:22,backgroundColor:'#E7F5EE',alignItems:'center',justifyContent:'center'},
  syncCopy:{flex:1},syncTitle:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:14,color:COLORS.navy},
  syncSub:{fontFamily:FONTS.regular,fontSize:11,color:COLORS.textMuted,lineHeight:16,marginTop:2},
  sectionTitle:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:17,color:COLORS.navy,marginBottom:11},
  actionGrid:{flexDirection:'row',flexWrap:'wrap',gap:9,marginBottom:20},
  quickAction:{flexGrow:1,flexBasis:'47%',minWidth:'47%',minHeight:94,borderRadius:13,padding:11,flexDirection:'row',alignItems:'center',gap:8},
  quickIcon:{width:34,height:34,borderRadius:18,alignItems:'center',justifyContent:'center'},
  quickCopy:{flex:1,minWidth:0,gap:3},quickTitle:{fontSize:12,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.navy},
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
