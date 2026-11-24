import React,{useEffect,useRef,useState} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {COLORS,FONTS,ScreenHeader,SmartButton,SurfaceCard,formatTimestamp} from '../components';
import {EndDutySteps} from '../OperationalMaterial';
import {enqueueHandover} from '../handover-outbox';
import {getEndDutyStatus} from '../end-duty-state';
import {db,syncRecords,type Duty,type LocalRecord} from '../offline';
import {supabase} from '../api';

type Operation={id:string;slot:string;kind:'submit'|'receive';state:string;error:string|null;payload:string};
type Incident={id:string;site_id:string;public_number:string;status:string};
type SavedHandover={p_notes?:string;p_equipment?:string;p_incident_ids?:string[]};

/**
 * UI redesign of the existing End Duty flow. This does not replace the actual
 * encrypted outbox or the server confirmation flow. "Received" means server
 * receipt, never incoming guard acceptance.
 */
export function EndDutyScreen({actor,duty,guardName,online,records,operations,incidents,onRefresh,onBack,onQueue}:{
 actor:string;duty:Duty;guardName:string|null;online:boolean;records:LocalRecord[];operations:Operation[];
 incidents:Incident[];onRefresh:()=>Promise<void>;onBack:()=>void;onQueue:()=>void;
}){
 const [notes,setNotes]=useState('');
 const [equipment,setEquipment]=useState('');
 const [refs,setRefs]=useState<string[]>([]);
 const [reviewing,setReviewing]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [savedLocally,setSavedLocally]=useState(false);
 const [now,setNow]=useState(Date.now());
 const [incoming,setIncoming]=useState<string|null>(null);
 const lock=useRef(false);
 const endDutyStatus=getEndDutyStatus(operations,duty.shift_id);
 const legacyHandover=endDutyStatus==='legacy-handover';
 const operation=legacyHandover?undefined:operations.find(o=>o.kind==='submit'&&o.slot===duty.shift_id);
 let savedHandover:SavedHandover|null=null;
 if(operation){try{savedHandover=JSON.parse(operation.payload) as SavedHandover;}catch{savedHandover=null;}}
 const unsent=records.filter(r=>r.shift_id===duty.shift_id&&r.state!=='received');
 const elapsed=Math.max(0,Math.floor((now-Date.parse(duty.started_at))/60000));
 const finished=Boolean(operation||savedLocally);
 const step:1|2|3=finished||legacyHandover?3:reviewing?2:1;
 const openIncidents=incidents.filter(i=>i.site_id===duty.site_id&&!['closed','resolved'].includes(i.status));

 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  let active=true;setIncoming(null);
  if(online&&duty.successor_shift_id){
   void supabase.rpc('guard_handover_recipient',{p_shift_id:duty.shift_id}).then(({data})=>{
    if(active&&typeof data==='string')setIncoming(data);
   });
  }
  return()=>{active=false;};
 },[online,duty.shift_id,duty.successor_shift_id]);

 async function confirm(){
  if(lock.current||operation||legacyHandover||savedLocally)return;
  if(notes.trim()&&notes.trim().length<5){setError('Handover notes must contain at least 5 characters.');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const d=await db();
   await enqueueHandover(d,actor,'submit',duty.shift_id,{
    p_id:Crypto.randomUUID(),p_shift_id:duty.shift_id,p_incoming_shift_id:duty.successor_shift_id??null,
    p_notes:notes.trim()||'No additional handover notes.',p_equipment:equipment.trim(),
    p_incident_ids:refs,p_ended_at:new Date().toISOString(),
   });
   setSavedLocally(true);
   if(online){try{await syncRecords(actor);}
    catch{setError('End Duty was saved on this phone, but automatic sync did not complete. Open the sync queue to retry.');}}
   try{await onRefresh();}
   catch{setError('End Duty was saved on this phone, but its status could not be refreshed. Open the sync queue to review it.');}
  }catch(e){setError(e instanceof Error?e.message:'End Duty could not be saved locally. Please retry.');}
  finally{lock.current=false;setBusy(false);}
 }

 const askConfirm=()=>Alert.alert('Confirm End Duty',duty.successor_shift_id?
  'Save the end-duty record? Server receipt and incoming guard acceptance are separate events.':
  'No replacement is assigned. Save the end-duty record? Follow the approved coverage procedure before leaving your post.',[
   {text:'Return to review',style:'cancel'},
   {text:'Save End Duty',onPress:()=>void confirm()},
  ]);

 return <View style={styles.root}>
  <ScreenHeader title="End Duty" onBack={onBack}/>
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
   <EndDutySteps step={step}/>
   <View style={styles.intro}>
    <Text style={styles.kicker}>SHIFT HANDOVER</Text>
    <Text style={styles.display}>{step===1?'Prepare your handover':step===2?'Review your handover':'End Duty status'}</Text>
    <Text style={styles.body}>{step===1?'Record outstanding work before closing the shift.':step===2?'Check the details carefully. The guard and supervisor must follow approved handover procedures.':'Check the saved record and its actual server receipt.'}</Text>
   </View>
   <View style={styles.dutyPanel}>
    <Text style={styles.heading}>{duty.post||'Assigned post'}</Text>
    <Text style={styles.body}>{duty.site_name} · {guardName||'Guard'}</Text>
    <View style={styles.infoRow}><Text style={styles.caption}>Started · {formatTimestamp(duty.started_at)}</Text><Text style={styles.caption}>Duration · {Math.floor(elapsed/60)}h {elapsed%60}m</Text></View>
   </View>

   <SurfaceCard style={styles.flatCard}>
    <Text style={styles.heading}>Records waiting to sync · {unsent.length}</Text>
    {unsent.length?unsent.map(r=><Text key={r.id} style={styles.body}>
     {r.kind==='incident'?'Incident':'Occurrence'} · {r.state==='failed'?'Sync failed':'Waiting to sync'} · {r.id.slice(0,8)}
    </Text>):<Text style={styles.body}>No unsent incident or occurrence records.</Text>}
    {unsent.length?<SmartButton variant="secondary" label="Open sync queue" onPress={onQueue}/>:null}
   </SurfaceCard>

   <View style={styles.handover}>
    <Text style={styles.heading}>Incoming coverage</Text>
    <Text style={styles.body}>{duty.successor_shift_id?
      'Assigned replacement · '+(incoming||'Name not available'):
      'No incoming guard assigned. Notify the supervisor and follow the approved site coverage procedure.'}</Text>
    {legacyHandover?<Text accessibilityRole="alert" style={styles.error}>
      This older outgoing handover has no end-duty timestamp. Ask a supervisor to verify server shift status before proceeding.
    </Text>:null}
    {operation?<View style={styles.receipt} accessibilityLiveRegion="polite">
      <Text style={styles.receiptHeading}>{operation.state==='received'?'Received by server':operation.state==='failed'?'Saved locally · Sync failed':'Saved locally · Server receipt pending'}</Text>
      <Text style={styles.body}>Server receipt does not confirm incoming guard acceptance.</Text>
      {operation.error?<Text style={styles.error}>{operation.error}</Text>:null}
    </View>:null}
    {savedLocally&&!operation?<View style={styles.receipt} accessibilityLiveRegion="polite">
      <Text style={styles.receiptHeading}>Saved on this phone</Text>
      <Text style={styles.body}>Server receipt is not yet confirmed. Check the sync queue.</Text>
    </View>:null}

    {!operation&&!legacyHandover&&!savedLocally?(reviewing?<>
      <Text style={styles.label}>Handover notes</Text>
      <Text style={styles.body}>{notes.trim()||'No additional handover notes.'}</Text>
      <Text style={styles.label}>Equipment</Text>
      <Text style={styles.body}>{equipment.trim()||'None recorded'}</Text>
      <Text style={styles.label}>Unresolved incident references</Text>
      <Text style={styles.body}>{refs.length?refs.join(', '):'None selected'}</Text>
      <SmartButton variant="secondary" label="Edit handover" onPress={()=>setReviewing(false)}/>
    </>:<>
      <Text style={styles.label}>Handover notes</Text>
      <TextInput accessibilityLabel="Handover notes" multiline maxLength={3000} value={notes}
       onChangeText={setNotes} placeholder="What does the next guard need to know?" placeholderTextColor={COLORS.textMuted}
       style={styles.input}/>
      <Text style={styles.label}>Equipment and keys</Text>
      <TextInput accessibilityLabel="Equipment being handed over" multiline maxLength={3000} value={equipment}
       onChangeText={setEquipment} placeholder="Keys, radio, torch and their condition" placeholderTextColor={COLORS.textMuted}
       style={styles.input}/>
      <Text style={styles.label}>Unresolved incidents</Text>
      {openIncidents.length?openIncidents.map(i=><SmartButton key={i.id} variant="secondary"
       label={(refs.includes(i.id)?'✓ ':'')+i.public_number}
       onPress={()=>setRefs(previous=>previous.includes(i.id)?previous.filter(id=>id!==i.id):[...previous,i.id])}/> ):
       <Text style={styles.body}>No unresolved incidents in the loaded records.</Text>}
    </>):null}
    {savedHandover?<View style={styles.savedDetails}>
      <Text style={styles.label}>Recorded handover</Text>
      <Text style={styles.body}>Notes · {savedHandover.p_notes||'None recorded'}</Text>
      <Text style={styles.body}>Equipment · {savedHandover.p_equipment||'None recorded'}</Text>
      <Text style={styles.body}>Incident references · {savedHandover.p_incident_ids?.join(', ')||'None'}</Text>
    </View>:null}
   </View>
   {!!error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
   {operation&&operation.state!=='received'?<SmartButton
     label={busy?'Retrying…':'Retry sync'} disabled={!online||busy} onPress={async()=>{
      if(lock.current)return;lock.current=true;setBusy(true);setError('');
      try{await syncRecords(actor);await onRefresh();}
      catch(e){setError(e instanceof Error?e.message:'Sync failed. The saved record remains on this device.');}
      finally{lock.current=false;setBusy(false);}
     }}/>:null}
   {(savedLocally||legacyHandover)?<SmartButton variant="secondary" label="Open sync queue" onPress={onQueue}/>:null}
   {!operation&&!legacyHandover&&!savedLocally?<SmartButton label={busy?'Saving…':reviewing?'Confirm End Duty':'Review End Duty'} disabled={busy}
    onPress={()=>{
     if(!reviewing){if(notes.trim()&&notes.trim().length<5){setError('Handover notes must contain at least 5 characters.');return;}setError('');setReviewing(true);}else askConfirm();
    }}/>:null}
   <SmartButton variant="secondary" label="Return to current shift" onPress={onBack}/>
  </ScrollView>
 </View>;
}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.background},content:{padding:16,paddingBottom:36,gap:13},
 intro:{gap:6,marginBottom:5},kicker:{fontSize:11,fontFamily:FONTS.bold,letterSpacing:1,color:COLORS.primary},
 display:{fontSize:27,lineHeight:34,fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text},
 heading:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:17,color:COLORS.primary},
 body:{fontFamily:FONTS.regular,color:COLORS.text,lineHeight:22,fontSize:14},
 caption:{fontFamily:FONTS.regular,color:COLORS.textMuted,fontSize:12,lineHeight:18},
 label:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.primary,marginTop:10,fontSize:13},
 dutyPanel:{backgroundColor:'#F0F7F1',borderLeftColor:'#16A34A',borderLeftWidth:5,borderRadius:16,padding:15,gap:5},
 infoRow:{flexDirection:'row',gap:12,flexWrap:'wrap',marginTop:6},
 flatCard:{borderRadius:14,marginBottom:0,gap:9},
 handover:{backgroundColor:COLORS.surface,borderColor:COLORS.border,borderWidth:1,borderRadius:15,padding:15,gap:10},
 input:{borderWidth:1,borderColor:COLORS.border,borderRadius:10,minHeight:90,padding:12,textAlignVertical:'top',
  color:COLORS.text,fontSize:14,backgroundColor:COLORS.white},
 receipt:{backgroundColor:'#F0F7F1',borderRadius:11,padding:12,gap:5},
 receiptHeading:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.primary,fontSize:14},
 savedDetails:{gap:7,paddingTop:10,borderTopWidth:1,borderTopColor:COLORS.border},
 error:{color:COLORS.danger,lineHeight:21,fontSize:13,fontFamily:FONTS.medium},
});
