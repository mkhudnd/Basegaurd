import React,{useEffect,useMemo,useState} from 'react';
import {BackHandler,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {BottomNavBar,COLORS,FONTS,InfoAlertBanner,ScreenHeader,ScreenHeaderActionButton,SmartButton,type GuardTabKey} from '../components';
import {localDateTime,parseLocalDateTime} from '../incident-domain';
import {OB_CHOICES,composeObNarrative,emptyObFields,filterObRows,obDateKey,obTimeKey,obTitle,type ObCategory,type ObFieldValues,type ObRow} from '../occurrence-ui';

const icon=(name:string)=>name as React.ComponentProps<typeof Ionicons>['name'];
export type OccurrenceDraft={category:ObCategory;narrative:string;eventAt:string};
export type OccurrenceBookScreenProps={
 rows:ObRow[]; isOnline:boolean; hasDuty:boolean; dutyStatus:string; pendingCount:number;
 error?:string|null; saving:boolean; openEntryRequest:number;
 activeShiftId?:string;onReportEntry:(row:ObRow)=>void;
 onSave:(draft:OccurrenceDraft,syncImmediately:boolean)=>Promise<void>;
 onSelectTab:(tab:GuardTabKey)=>void;onOpenSyncQueue:()=>void;onRefresh:()=>void;
 onOpenDuty:()=>void;onOpenDraftChange?:(open:boolean)=>void;onRequestConsumed?:()=>void;
};
const formatDate=(iso:string)=>{
 const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString('en-ZW',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Unknown time';
};
const statusInfo=(status:ObRow['status'])=>status==='received'?{name:'Received',bg:'#E3F6EB',fg:COLORS.success}:status==='failed'?{name:'Sync Failed',bg:COLORS.dangerSoft,fg:COLORS.danger}:status==='sending'?{name:'Sending',bg:COLORS.offlineSoft,fg:COLORS.offline}:{name:'Pending Sync',bg:COLORS.offlineSoft,fg:COLORS.offline};
const initialForm=()=>{const now=localDateTime(new Date().toISOString());return {date:now.slice(0,10),time:now.slice(11,16)};};

export const OccurrenceBookScreen:React.FC<OccurrenceBookScreenProps>=({
 activeShiftId,onReportEntry,rows,isOnline,hasDuty,dutyStatus,pendingCount,error,saving,openEntryRequest,onSave,onSelectTab,onOpenSyncQueue,onRefresh,onOpenDuty,onOpenDraftChange,onRequestConsumed,
})=>{
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState<'all'|'pending'|'received'|'today'>('today');
 const [categoryFilter,setCategoryFilter]=useState<'all'|ObCategory>('all');
 const [chooserOpen,setChooserOpen]=useState(false);
 const [formCategory,setFormCategory]=useState<ObCategory|null>(null);
 const [fields,setFields]=useState<ObFieldValues>(emptyObFields);
 const [dateText,setDateText]=useState(()=>initialForm().date);
 const [timeText,setTimeText]=useState(()=>initialForm().time);
 const [formError,setFormError]=useState('');
 const [details,setDetails]=useState<ObRow|null>(null);
 useEffect(()=>{if(openEntryRequest>0 && hasDuty){setChooserOpen(true);onOpenDraftChange?.(true);onRequestConsumed?.();}},[openEntryRequest]);
 useEffect(()=>{if(!formCategory)return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{setFormCategory(null);onOpenDraftChange?.(false);return true;});return ()=>subscription.remove();},[formCategory]);
 const today=obDateKey(new Date().toISOString());
 const visible=useMemo(()=>filterObRows(rows,query,filter,categoryFilter,today),[rows,query,filter,categoryFilter,today]);
 const setField=(key:keyof ObFieldValues)=>(value:string)=>setFields(v=>({...v,[key]:value}));
 const begin=(category:ObCategory)=>{
  const now=initialForm();setDateText(now.date);setTimeText(now.time);
  setFields(emptyObFields());setFormError('');setFormCategory(category);setChooserOpen(false);onOpenDraftChange?.(true);
 };
 const cancelForm=()=>{setFormCategory(null);setFormError('');onOpenDraftChange?.(false);};
 const closeChooser=()=>{setChooserOpen(false);onOpenDraftChange?.(false);};
 async function handleSubmit(immediate:boolean){
  if(!formCategory || saving)return;
  try{
   const eventAt=parseLocalDateTime(`${dateText.trim()} ${timeText.trim()}`);
   if(!eventAt)throw new Error('Enter a valid date (YYYY-MM-DD) and time (HH:mm).');
   const narrative=composeObNarrative(formCategory,fields);
   setFormError('');
   await onSave({category:formCategory,narrative,eventAt},immediate);
   // Parent navigates to the existing saved-locally/received confirmation screen.
  }catch(e){setFormError(e instanceof Error?e.message:'Unable to save this entry.');}
 }
 const filters:[typeof filter,string][]=[['all','All'],['pending','Pending Sync'],['received','Received'],['today','Today']];
 return <View style={styles.root}>
  {formCategory ? <>
    <ScreenHeader title="New OB Entry" subtitle={obTitle(formCategory)} onBack={cancelForm} backAccessibilityLabel="Back to occurrence book"/>
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
      <ScrollView style={{flex:1}} contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
        <View style={styles.contextStrip}><Ionicons name={icon(OB_CHOICES.find(c=>c.category===formCategory)?.icon??'document-outline')} size={21} color={COLORS.primary}/>
          <Text style={styles.contextText}>Save to your verified shift. The original entry is kept after server receipt.</Text>
        </View>
        <Text style={styles.fieldLabel}>Date and time of occurrence *</Text>
        <View style={styles.inputRow}>
          <View style={{flex:1.3}}><TextInput accessibilityLabel="Occurrence date YYYY-MM-DD" value={dateText} onChangeText={setDateText} autoCapitalize="none" placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" style={styles.input}/></View>
          <View style={{flex:0.75}}><TextInput accessibilityLabel="Occurrence time HH:mm" value={timeText} onChangeText={setTimeText} autoCapitalize="none" placeholder="HH:mm" keyboardType="numbers-and-punctuation" style={styles.input}/></View>
        </View>
        {formCategory==='patrol'?<>
          <Field label="Patrol area / route *" value={fields.location} onChange={setField('location')} placeholder="e.g. Main Gate – Perimeter"/>
          <Field label="Observations *" value={fields.observation} onChange={setField('observation')} placeholder="What did you observe?" multiline/>
        </>:null}
        {formCategory==='visitor'?<>
          <Field label="Visitor name / organisation *" value={fields.visitorName} onChange={setField('visitorName')} placeholder="Name or business"/>
          <Field label="Purpose of visit *" value={fields.visitPurpose} onChange={setField('visitPurpose')} placeholder="e.g. Delivery / Meeting"/>
          <Field label="Host / contact person" value={fields.contact} onChange={setField('contact')} placeholder="Optional"/>
          <Field label="Vehicle registration" value={fields.vehicle} onChange={setField('vehicle')} placeholder="Optional"/>
        </>:null}
        {formCategory==='equipment'?<>
          <Field label="Area / equipment checked *" value={fields.checkArea} onChange={setField('checkArea')} placeholder="e.g. Main gate / CCTV"/>
          <Field label="Inspection result *" value={fields.result} onChange={setField('result')} placeholder="Condition and issues found" multiline/>
        </>:null}
        {(formCategory==='routine'||formCategory==='other')?<Field label="Occurrence details *" value={fields.observation} onChange={setField('observation')} placeholder="Describe what happened" multiline/>:null}
        {formCategory!=='routine'&&formCategory!=='other'?<Field label="Additional notes" value={fields.notes} onChange={setField('notes')} placeholder="Optional" multiline/>:null}
        <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={COLORS.primary}/>
          <Text style={styles.noticeText}>Only text entries are supported at present. Photos and correction requests are not yet enabled. Offline saves remain on this phone until synchronized.</Text>
        </View>
        {formError?<InfoAlertBanner tone="danger" title="Check this entry" body={formError}/>:null}
        <View style={styles.inputRow}>
          <View style={{flex:1}}><SmartButton label={saving?'Saving…':'Save on Phone'} onPress={()=>void handleSubmit(false)} variant="secondary" disabled={saving||!hasDuty}/></View>
          <View style={{flex:1}}><SmartButton label={saving?'Saving…':'Save & Sync'} onPress={()=>void handleSubmit(true)} disabled={saving||!hasDuty}/></View>
        </View>
        <Text style={styles.footnote}>Save & Sync tries once when online. Neither button claims the supervisor has received the entry before a server receipt is returned.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </>:<>
    <ScreenHeader title="Occurrence Book" rightAction={<ScreenHeaderActionButton accessibilityLabel={`Duty status: ${dutyStatus}`} onPress={onOpenDuty}>
      <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.white}/>
    </ScreenHeaderActionButton>}/>
    <ScrollView style={{flex:1}} contentContainerStyle={styles.listBody} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}><Text style={styles.pageTitle}>Occurrence Book</Text><Text style={styles.subtitle}>Log patrols, visitors and daily events.</Text></View>
      {!isOnline?<InfoAlertBanner tone="offline" title="You're offline" body="You can view records on this phone and save new entries. Remote records will be available when you reconnect."/>:null}
      {error?<InfoAlertBanner tone="warning" title="Some entries may be unavailable" body={error}/>:null}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={19} color={COLORS.textMuted}/>
        <TextInput accessibilityLabel="Search occurrence entries" placeholder="Search entries, locations…" placeholderTextColor={COLORS.textMuted} value={query} onChangeText={setQuery} style={styles.searchInput}/>
        <Pressable accessibilityLabel="Refresh occurrence entries" accessibilityRole="button" onPress={onRefresh} style={styles.refresh}><Ionicons name="refresh-outline" size={22} color={COLORS.primary}/></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {filters.map(([key,label])=><Pressable key={key} accessibilityRole="button" accessibilityState={{selected:filter===key}} onPress={()=>setFilter(key)} style={[styles.chip,filter===key&&styles.chipActive]}><Text style={[styles.chipText,filter===key&&styles.chipTextActive]}>{label}</Text></Pressable>)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChips}>
        {[{category:'all',title:'All types'},...OB_CHOICES].map(({category,title})=><Pressable key={category} accessibilityRole="button" accessibilityState={{selected:categoryFilter===category}} onPress={()=>setCategoryFilter(category as 'all'|ObCategory)} style={[styles.typeChip,categoryFilter===category&&styles.typeChipActive]}><Text style={[styles.typeChipText,categoryFilter===category&&styles.typeChipTextActive]}>{title}</Text></Pressable>)}
      </ScrollView>
      <SmartButton label="+  New OB Entry" onPress={()=>{setChooserOpen(true);onOpenDraftChange?.(true);}} disabled={!hasDuty}/>
      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Entries</Text><Pressable accessibilityRole="button" onPress={onOpenSyncQueue}><Text style={styles.queueLink}>{pendingCount>0?`${pendingCount} unsent · View Queue`:'Sync Queue'}  ›</Text></Pressable></View>
      {visible.length?visible.map(row=>{
        const status=statusInfo(row.status);
        const choice=OB_CHOICES.find(c=>c.category===row.category);
        return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${obTitle(row.category)}: ${status.name}. Open details`} onPress={()=>setDetails(row)} style={styles.entryCard}>
          <View style={styles.entryIcon}><Ionicons name={icon(choice?.icon??'document-text-outline')} size={23} color={COLORS.primary}/></View>
          <View style={{flex:1,minWidth:0}}><Text style={styles.entryTitle} numberOfLines={1}>{obTitle(row.category)}</Text><Text style={styles.entryExcerpt} numberOfLines={2}>{row.narrative}</Text><Text style={styles.entryTime}>{formatDate(row.eventAt)}</Text></View>
          <View style={styles.rightColumn}><View style={[styles.statusChip,{backgroundColor:status.bg}]}><Text style={[styles.statusText,{color:status.fg}]}>{status.name}</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.textMuted}/></View>
        </Pressable>;
      }):<View style={styles.emptyCard}><Ionicons name="document-text-outline" size={33} color={COLORS.textMuted}/><Text style={styles.emptyTitle}>No matching entries</Text><Text style={styles.emptyBody}>{rows.length?'Change your filters or search terms.':'Your occurrence entries will appear here after you save one.'}</Text></View>}
      <Text style={styles.footnote}>Pending records are stored in this device's encrypted queue. Received records are confirmed by the server. Only your authorized records are shown.</Text>
    </ScrollView>
    <BottomNavBar activeTab="ob" onSelectTab={onSelectTab} unsyncedCount={pendingCount}/>
  </>}
  <Modal visible={chooserOpen&&!formCategory} animationType="slide" transparent onRequestClose={closeChooser}>
    <View style={styles.modalBackdrop}><Pressable accessibilityRole="button" accessibilityLabel="Dismiss entry picker" style={StyleSheet.absoluteFill} onPress={closeChooser}/>
      <View style={styles.sheet}><View style={styles.sheetHandle}/><View style={styles.sheetHead}><View><Text style={styles.sheetTitle}>New OB Entry</Text><Text style={styles.subtitle}>Choose the type of occurrence to record.</Text></View><Pressable accessibilityLabel="Close" onPress={closeChooser} style={styles.closeHit}><Ionicons name="close" size={24} color={COLORS.navy}/></Pressable></View>
        {OB_CHOICES.map(choice=><Pressable key={choice.category} accessibilityRole="button" accessibilityLabel={`Create ${choice.title} entry`} onPress={()=>begin(choice.category)} style={styles.choiceRow}>
          <View style={styles.choiceIcon}><Ionicons name={icon(choice.icon)} size={22} color={COLORS.primary}/></View><View style={{flex:1}}><Text style={styles.choiceTitle}>{choice.title}</Text><Text style={styles.choiceHint}>{choice.hint}</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.textMuted}/>
        </Pressable>)}
      </View>
    </View>
  </Modal>
  <Modal visible={!!details} animationType="slide" onRequestClose={()=>setDetails(null)}>
    <View style={styles.root}><ScreenHeader title="Entry Details" onBack={()=>setDetails(null)}/>
      {details?<ScrollView contentContainerStyle={styles.formBody}>
        <View style={styles.detailCard}><Text style={styles.entryTitle}>{obTitle(details.category)}</Text><Text style={styles.entryTime}>{formatDate(details.eventAt)}</Text><View style={[styles.statusChip,{backgroundColor:statusInfo(details.status).bg,alignSelf:'flex-start',marginTop:12}]}><Text style={[styles.statusText,{color:statusInfo(details.status).fg}]}>{statusInfo(details.status).name}</Text></View></View>
        <Text style={styles.fieldLabel}>Original occurrence narrative</Text><Text selectable style={styles.detailNarrative}>{details.narrative}</Text>
        {details.createdAt?<><Text style={styles.fieldLabel}>Saved on this device</Text><Text style={styles.entryExcerpt}>{formatDate(details.createdAt)}</Text></>:null}
        {details.receivedAt?<><Text style={styles.fieldLabel}>Server received</Text><Text style={styles.entryExcerpt}>{formatDate(details.receivedAt)}</Text></>:null}
        {details.linkedIncidentId||activeShiftId&&details.shiftId===activeShiftId?<SmartButton label={details.linkedIncidentId?'View linked incident':'Report as incident'} onPress={()=>onReportEntry(details)}/>:null}
        {details.error?<InfoAlertBanner title="Sync needs attention" tone="warning" body={details.error}/>:null}
        <View style={styles.notice}><Ionicons name="lock-closed-outline" size={20} color={COLORS.primary}/><Text style={styles.noticeText}>The original record is preserved. Corrections require an approved, audited workflow and are not yet available in this app.</Text></View>
        {details.status!=='received'?<SmartButton label="Review Sync Queue" onPress={()=>{setDetails(null);onOpenSyncQueue();}}/>:null}
      </ScrollView>:null}
    </View>
  </Modal>
 </View>;
};

function Field({label,value,onChange,placeholder,multiline=false}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string;multiline?:boolean}){
 return <View style={{gap:7}}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={COLORS.textMuted} multiline={multiline} maxLength={2800} textAlignVertical={multiline?'top':'center'} style={[styles.input,multiline&&styles.textArea]}/></View>;
}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.surface},
 listBody:{paddingHorizontal:17,paddingBottom:24,gap:12},heading:{marginBottom:4},pageTitle:{fontSize:26,fontFamily:FONTS.bold,color:COLORS.navy},subtitle:{fontSize:13,color:COLORS.textMuted,lineHeight:20},
 searchRow:{borderWidth:1,borderColor:COLORS.border,borderRadius:12,minHeight:48,paddingLeft:12,flexDirection:'row',alignItems:'center',gap:10},searchInput:{flex:1,color:COLORS.text,fontSize:14,paddingVertical:5},refresh:{width:48,height:48,alignItems:'center',justifyContent:'center',borderLeftWidth:1,borderLeftColor:COLORS.border},
 chips:{gap:7,paddingVertical:2},chip:{backgroundColor:COLORS.background,borderRadius:24,paddingVertical:10,paddingHorizontal:14,minHeight:48,justifyContent:'center'},chipActive:{backgroundColor:COLORS.primary},chipText:{fontSize:12,color:COLORS.textMuted},chipTextActive:{color:COLORS.white,fontFamily:FONTS.bold},
 categoryChips:{gap:7,paddingVertical:1},typeChip:{borderRadius:20,borderWidth:1,borderColor:COLORS.border,paddingHorizontal:12,paddingVertical:8,minHeight:48,justifyContent:'center'},typeChipActive:{backgroundColor:COLORS.primarySoft,borderColor:COLORS.primary},typeChipText:{fontSize:12,color:COLORS.textMuted},typeChipTextActive:{color:COLORS.primary,fontFamily:FONTS.bold},
 sectionRow:{marginTop:5,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:7},sectionTitle:{fontSize:16,fontFamily:FONTS.bold,color:COLORS.navy},queueLink:{fontSize:12,color:COLORS.primary},
 entryCard:{flexDirection:'row',alignItems:'center',borderRadius:14,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.white,paddingHorizontal:11,paddingVertical:12,gap:10,minHeight:92},entryIcon:{width:42,height:42,borderRadius:24,backgroundColor:COLORS.primarySoft,alignItems:'center',justifyContent:'center'},entryTitle:{fontSize:14,color:COLORS.navy,fontFamily:FONTS.bold},entryExcerpt:{fontSize:12,color:COLORS.textMuted,lineHeight:19,marginTop:2},entryTime:{fontSize:11,color:COLORS.textMuted,marginTop:5},rightColumn:{alignItems:'flex-end',gap:11},statusChip:{borderRadius:15,paddingHorizontal:8,paddingVertical:5},statusText:{fontSize:10,fontFamily:FONTS.medium},
 emptyCard:{marginTop:10,alignItems:'center',borderWidth:1,borderColor:COLORS.border,borderRadius:14,padding:28,gap:10},emptyTitle:{fontSize:16,fontFamily:FONTS.bold,color:COLORS.navy},emptyBody:{textAlign:'center',color:COLORS.textMuted,fontSize:12,lineHeight:18},footnote:{fontSize:11,lineHeight:17,color:COLORS.textMuted},
 formBody:{padding:16,gap:14,paddingBottom:38},contextStrip:{backgroundColor:COLORS.primarySoft,flexDirection:'row',alignItems:'center',gap:10,padding:13,borderRadius:13},contextText:{fontSize:12,lineHeight:18,color:COLORS.primary,flex:1},
 fieldLabel:{fontSize:13,fontFamily:FONTS.bold,color:COLORS.navy},inputRow:{flexDirection:'row',gap:10},input:{borderColor:COLORS.border,borderWidth:1,borderRadius:11,paddingHorizontal:12,minHeight:48,color:COLORS.text,fontSize:14,backgroundColor:COLORS.white},textArea:{height:120,paddingTop:12},notice:{flexDirection:'row',gap:10,backgroundColor:'#F0F6FA',padding:13,borderRadius:12},noticeText:{fontSize:12,lineHeight:19,color:COLORS.textMuted,flex:1},
 modalBackdrop:{flex:1,backgroundColor:'rgba(15,30,34,0.5)',justifyContent:'flex-end'},sheet:{backgroundColor:COLORS.white,borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:16,paddingTop:12,paddingBottom:28,gap:9},sheetHandle:{height:4,width:46,backgroundColor:COLORS.border,borderRadius:2,alignSelf:'center',marginBottom:8},sheetHead:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8},sheetTitle:{fontFamily:FONTS.bold,color:COLORS.navy,fontSize:20},closeHit:{height:48,width:48,alignItems:'center',justifyContent:'center'},choiceRow:{borderWidth:1,borderColor:COLORS.border,borderRadius:13,flexDirection:'row',alignItems:'center',padding:11,minHeight:66,gap:13},choiceIcon:{width:41,height:41,borderRadius:24,backgroundColor:COLORS.primarySoft,alignItems:'center',justifyContent:'center'},choiceTitle:{fontSize:14,fontFamily:FONTS.bold,color:COLORS.navy},choiceHint:{fontSize:11,color:COLORS.textMuted,marginTop:3},
 detailCard:{padding:18,borderRadius:14,backgroundColor:COLORS.background},detailNarrative:{fontSize:15,color:COLORS.text,lineHeight:24,backgroundColor:COLORS.background,padding:15,borderRadius:13},
});
