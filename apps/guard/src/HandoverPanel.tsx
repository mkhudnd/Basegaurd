import React,{useCallback,useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {enqueueHandover} from './handover-outbox';
import {db,syncRecords,type Duty} from './offline';
import {supabase} from './api';
import {COLORS,FONTS,SmartButton,SurfaceCard,formatTimestamp} from './components';
import type {EndDutyStatus} from './end-duty-state';

type Incoming={
 id:string;notes:string;equipment?:string;post?:string;outgoing_guard_id:string;accepted_by?:string;
 submitted_at:string;incident_ids?:string[];accepted_at:string|null;
};
type Props={actor:string;duty:Duty|null;overdue:boolean;online:boolean;endDutyStatus:EndDutyStatus;
 onRequestEndDuty:()=>void;onDelivered:()=>Promise<void>;};

const statusText:Record<EndDutyStatus,string>={
 none:'Prepare the outgoing handover using the dedicated End Duty screen.',
 queued:'End Duty saved on this phone. Waiting for server receipt.',
 sending:'End Duty is syncing. Server receipt is not yet confirmed.',
 failed:'End Duty saved on this phone. Synchronization failed; review the sync queue.',
 received:'The server received End Duty. Incoming guard acceptance is not confirmed by this receipt.',
 'legacy-handover':'An older outgoing handover has no end-duty timestamp. Ask a supervisor to verify the shift state.',
};

export function HandoverPanel({actor,duty,overdue,online,endDutyStatus,onRequestEndDuty,onDelivered}:Props){
 const [incoming,setIncoming]=useState<Incoming[]>([]);
 const [ops,setOps]=useState<{id:string;state:string;error:string|null}[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const lock=useRef(false);

 const load=useCallback(async()=>{
  const d=await db();
  setOps(await d.getAllAsync('SELECT id,state,error FROM handover_ops WHERE actor=? ORDER BY rowid DESC LIMIT 20',actor));
  const cached=await d.getFirstAsync<{payload:string}>('SELECT payload FROM incoming_cache WHERE actor=?',actor);
  const saved:unknown=cached?JSON.parse(cached.payload):[];
  setIncoming(Array.isArray(saved)?saved as Incoming[]:[]);
  if(online){
   const response=await supabase.from('shift_handovers').select('*').eq('incoming_guard_id',actor)
    .order('submitted_at',{ascending:false}).limit(20);
   if(response.error)throw new Error(response.error.message);
   await d.runAsync('INSERT OR REPLACE INTO incoming_cache VALUES(?,?)',actor,JSON.stringify(response.data));
   setIncoming(response.data??[]);
  }
 },[actor,online]);
 useEffect(()=>{void load().catch(e=>setError(String(e)));},[load]);

 async function acknowledge(receive:Incoming){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const d=await db();
   await enqueueHandover(d,actor,'receive',receive.id,{p_id:receive.id});
   if(online)await syncRecords(actor);
   await onDelivered();await load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save handover acknowledgement.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function retry(){
  if(lock.current||!online)return;lock.current=true;setBusy(true);setError('');
  try{await syncRecords(actor);await onDelivered();await load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to refresh handover status.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <View style={styles.content}>
  <View style={styles.dutyPanel}>
   <Text style={styles.eyebrow}>OUTGOING SHIFT</Text>
   <Text style={styles.display}>{duty?.post||'No assigned post'}</Text>
   <Text style={styles.body}>{duty?.site_name||'No active assignment'}</Text>
   {overdue&&<Text style={styles.status}>Overdue duty · End Duty only</Text>}
   <View style={styles.statusLine}>
    <Text accessibilityLiveRegion="polite" style={endDutyStatus==='legacy-handover'?styles.error:styles.status}>
     {statusText[endDutyStatus]}
    </Text>
   </View>
   {duty?<SmartButton variant="secondary" label={endDutyStatus==='none'?'Open End Duty':'Review End Duty'}
    onPress={onRequestEndDuty}/>:null}
  </View>

  <View style={styles.sectionHeader}>
   <Text style={styles.heading}>Incoming handovers</Text>
   <Text style={styles.count}>{incoming.length} loaded</Text>
  </View>
  {!incoming.length?<View style={styles.empty}>
   <Text style={styles.emptyTitle}>No incoming handovers</Text>
   <Text style={styles.body}>No assignments received in the latest available records.</Text>
  </View>:null}
  {incoming.map(h=><SurfaceCard key={h.id} style={styles.incomingCard}>
   <Text style={styles.heading}>{h.post||'Assigned post'}</Text>
   <Text style={styles.caption}>Submitted · {formatTimestamp(h.submitted_at)}</Text>
   <Text style={styles.body}>Outgoing guard · {h.outgoing_guard_id}</Text>
   <View style={styles.separator}/>
   <Text style={styles.body}>{h.notes}</Text>
   <Text style={styles.body}>Equipment · {h.equipment||'None recorded'}</Text>
   <Text style={styles.body}>Incident references · {h.incident_ids?.join(', ')||'None'}</Text>
   {h.accepted_at?<Text style={styles.status} accessibilityLiveRegion="polite">
    Accepted · {formatTimestamp(h.accepted_at)} · {h.accepted_by??actor}</Text>:
    <SmartButton label="Acknowledge receipt" disabled={busy} onPress={()=>void acknowledge(h)}/>}
  </SurfaceCard>)}
  {ops.length?<View style={styles.ops}>
   <Text style={styles.eyebrow}>LOCAL HANDOVER QUEUE</Text>
   {ops.map(o=><Text key={o.id} style={styles.caption}>{o.id.slice(0,8)} · {o.state==='received'?'Server received':o.state}{o.error?' · '+o.error:''}</Text>)}
  </View>:null}
  <SmartButton variant="secondary" label="Refresh and retry" disabled={!online||busy} onPress={()=>void retry()}/>
  {!!error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
 </View>;
}

const styles=StyleSheet.create({
 content:{gap:14},
 dutyPanel:{borderLeftWidth:5,borderLeftColor:'#16A34A',borderRadius:16,padding:16,backgroundColor:'#F0F7F1',gap:10},
 eyebrow:{fontFamily:FONTS.bold,color:COLORS.primary,fontSize:11,letterSpacing:0.8},
 display:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text,fontSize:23,lineHeight:29},
 heading:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.primary,fontSize:17},
 body:{fontFamily:FONTS.regular,color:COLORS.text,fontSize:14,lineHeight:21},
 caption:{fontFamily:FONTS.regular,color:COLORS.textMuted,fontSize:12,lineHeight:19},
 statusLine:{paddingVertical:9},status:{fontFamily:FONTS.medium,fontSize:13,lineHeight:20,color:COLORS.primary},
 sectionHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:12},
 count:{fontFamily:FONTS.medium,color:COLORS.textMuted,fontSize:12},
 empty:{padding:18,borderWidth:1,borderColor:COLORS.border,borderRadius:14,gap:7,backgroundColor:COLORS.surface},
 emptyTitle:{fontFamily:FONTS.bold,color:COLORS.text,fontSize:15},
 incomingCard:{borderRadius:14,gap:9,marginBottom:0},
 separator:{borderTopWidth:1,borderTopColor:COLORS.border,marginVertical:3},
 ops:{borderRadius:13,borderWidth:1,borderColor:COLORS.border,padding:13,gap:8},
 error:{color:COLORS.danger,fontSize:13,lineHeight:20},
});
