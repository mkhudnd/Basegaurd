import React,{useEffect,useRef,useState} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {COLORS,FONTS,ScreenHeader,SmartButton,SurfaceCard,formatTimestamp} from '../components';
import {enqueueHandover} from '../handover-outbox';
import {getEndDutyStatus} from '../end-duty-state';
import {db,syncRecords,type Duty,type LocalRecord} from '../offline';
import {supabase} from '../api';

type Operation={id:string;slot:string;kind:'submit'|'receive';state:string;error:string|null;payload:string};
type Incident={id:string;site_id:string;public_number:string;status:string};

export function EndDutyScreen({actor,duty,guardName,online,records,operations,incidents,onRefresh,onBack,onQueue}:{
 actor:string;duty:Duty;guardName:string|null;online:boolean;records:LocalRecord[];operations:Operation[];
 incidents:Incident[];onRefresh:()=>Promise<void>;onBack:()=>void;onQueue:()=>void;
}) {
 const [notes,setNotes]=useState('');
 const [equipment,setEquipment]=useState('');
 const [refs,setRefs]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [savedLocally,setSavedLocally]=useState(false);
 const [now,setNow]=useState(Date.now());
 const [incoming,setIncoming]=useState<string|null>(null);
 const lock=useRef(false);
 const endDutyStatus=getEndDutyStatus(operations,duty.shift_id);
 const legacyHandover=endDutyStatus==='legacy-handover';
 const operation=legacyHandover?undefined:operations.find(o=>o.kind==='submit'&&o.slot===duty.shift_id);
 let savedHandover:{p_notes?:string;p_equipment?:string;p_incident_ids?:string[]}|null=null;
 if(operation){try{savedHandover=JSON.parse(operation.payload);}catch{savedHandover=null;}}
 const unsent=records.filter(r=>r.shift_id===duty.shift_id&&r.state!=='received');
 const elapsed=Math.max(0,Math.floor((now-Date.parse(duty.started_at))/60000));
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
    p_notes:notes.trim()||'No additional handover notes.',p_equipment:equipment.trim(),p_incident_ids:refs,p_ended_at:new Date().toISOString(),
   });
   setSavedLocally(true);
   if(online){try{await syncRecords(actor);}
    catch{setError('End Duty was saved on this phone, but automatic sync did not complete. Open the sync queue to retry.');}}
   try{await onRefresh();}
   catch{setError('End Duty was saved on this phone, but its status could not be refreshed. Open the sync queue to review it.');}
  }catch(e){setError(e instanceof Error?e.message:'End Duty could not be saved locally. Please retry.');}
  finally{lock.current=false;setBusy(false);}
 }
 const askConfirm=()=>Alert.alert('Confirm end duty',duty.successor_shift_id?
  'Save the handover and end your shift?':'Save the handover and end your shift? No replacement is assigned.',[
   {text:'Return to shift',style:'cancel'},{text:'Confirm end duty',onPress:()=>void confirm()},
  ]);
 return <View style={styles.root}>
  <ScreenHeader title="End Duty" onBack={onBack}/>
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
   <SurfaceCard>
    <Text style={styles.heading}>{duty.site_name}</Text>
    <Text style={styles.body}>Post · {duty.post||'Not assigned'}</Text>
    <Text style={styles.body}>Guard · {guardName||'Guard'}</Text>
    <Text style={styles.body}>Started · {formatTimestamp(duty.started_at)}</Text>
    <Text style={styles.body}>Duration · {Math.floor(elapsed/60)}h {elapsed%60}m</Text>
   </SurfaceCard>
   <SurfaceCard>
    <Text style={styles.heading}>Records waiting to sync · {unsent.length}</Text>
    {unsent.map(r=><Text key={r.id} style={styles.body}>{r.kind==='incident'?'Incident':'Occurrence'} · {r.state==='failed'?'Sync failed':'Waiting to sync'} · {r.id.slice(0,8)}</Text>)}
    {!unsent.length?<Text style={styles.body}>No incident or occurrence records waiting to sync.</Text>:null}
    {unsent.length?<SmartButton variant="secondary" label="Open sync queue" onPress={onQueue}/>:null}
   </SurfaceCard>
   <SurfaceCard>
    <Text style={styles.heading}>Handover</Text>
    <Text style={styles.body}>{duty.successor_shift_id?
     'Incoming guard · '+(incoming||'Assigned replacement, name unavailable'):
     'No incoming guard assigned. The supervisor will see a coverage gap after sync.'}</Text>
    {operation?<Text accessibilityLiveRegion="polite" style={styles.body}>
     {operation.state==='received'?'End duty received by server':operation.state==='failed'?'End duty saved on phone · sync failed':'End duty saved on phone · waiting to sync'}
     {operation.error?'\n'+operation.error:''}
    </Text>:legacyHandover?<Text style={styles.error}>This previous outgoing handover has no end-duty timestamp. Ask a supervisor to check the server shift status before proceeding.</Text>:<>
     <Text style={styles.label}>Notes</Text>
     <TextInput accessibilityLabel="Handover notes" multiline maxLength={3000} value={notes} onChangeText={setNotes}
      placeholder="Notes for the next guard" style={styles.input}/>
     <Text style={styles.label}>Equipment</Text>
     <TextInput accessibilityLabel="Equipment being handed over" multiline maxLength={3000} value={equipment} onChangeText={setEquipment}
      placeholder="Keys, radio, torch and condition" style={styles.input}/>
     <Text style={styles.label}>Unresolved incidents</Text>
     {incidents.filter(i=>i.site_id===duty.site_id&&!['closed','resolved'].includes(i.status)).map(i=>
      <SmartButton key={i.id} variant="secondary" label={(refs.includes(i.id)?'✓ ':'')+i.public_number}
       onPress={()=>setRefs(previous=>previous.includes(i.id)?previous.filter(id=>id!==i.id):[...previous,i.id])}/>)}
     {!incidents.some(i=>i.site_id===duty.site_id&&!['closed','resolved'].includes(i.status))?
      <Text style={styles.body}>No unresolved incidents in the loaded records.</Text>:null}
    </>}
    {savedHandover?<View>
     <Text style={styles.body}>Notes · {savedHandover.p_notes||'None recorded'}</Text>
     <Text style={styles.body}>Equipment · {savedHandover.p_equipment||'None recorded'}</Text>
     <Text style={styles.body}>Incident references · {savedHandover.p_incident_ids?.join(', ')||'None'}</Text>
    </View>:null}
   </SurfaceCard>
   {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
   {operation&&operation.state!=='received'?
    <SmartButton label={busy?'Retrying…':'Retry sync'} disabled={!online||busy} onPress={async()=>{
     if(lock.current)return;lock.current=true;setBusy(true);setError('');
     try{await syncRecords(actor);await onRefresh();}catch(e){setError(e instanceof Error?e.message:'Sync failed');}
     finally{lock.current=false;setBusy(false);}
    }}/>:null}
   {savedLocally&&!operation?<Text accessibilityLiveRegion="polite" style={styles.body}>End Duty is saved locally. Server receipt is not yet confirmed.</Text>:null}
   {(savedLocally||legacyHandover)?<SmartButton variant="secondary" label="Open sync queue" onPress={onQueue}/>:null}
   {!operation&&!legacyHandover&&!savedLocally?<SmartButton label={busy?'Saving…':'Confirm End Duty'} disabled={busy} onPress={askConfirm}/>:null}
   <SmartButton variant="secondary" label={operation?'Back to Home':'Return to current shift'} onPress={onBack}/>
  </ScrollView>
 </View>;
}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.background},
 content:{padding:16,paddingBottom:32,gap:12},
 heading:{fontFamily:FONTS.bold,fontWeight:'700',fontSize:17,color:COLORS.navy},
 body:{fontFamily:FONTS.regular,color:COLORS.text,lineHeight:21},
 label:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.navy,marginTop:6},
 input:{borderWidth:1,borderColor:COLORS.border,borderRadius:10,minHeight:80,padding:12,textAlignVertical:'top',color:COLORS.text},
 error:{color:COLORS.danger,lineHeight:20},
});
