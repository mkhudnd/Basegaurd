import React,{useCallback,useEffect,useState} from 'react';
import {enqueueHandover} from './handover-outbox';
import {Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {db,syncRecords,type Duty} from './offline';
import {supabase} from './api';
import {SmartButton,SurfaceCard} from './components';

type Incoming={id:string;notes:string;equipment?:string;post?:string;outgoing_guard_id:string;accepted_by?:string;submitted_at:string;incident_ids?:string[];accepted_at:string|null};
export function HandoverPanel({actor,duty,online,incidents,onDelivered}:{actor:string;duty:Duty|null;online:boolean;
 incidents:{id:string;site_id:string;public_number:string;status:string}[];onDelivered:()=>Promise<void>}) {
 const [notes,setNotes]=useState(''),[equipment,setEquipment]=useState(''),[refs,setRefs]=useState<string[]>([]);
 const [incoming,setIncoming]=useState<Incoming[]>([]),[ops,setOps]=useState<{id:string;state:string;error:string|null}[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{
  const d=await db();
  setOps(await d.getAllAsync('SELECT id,state,error FROM handover_ops WHERE actor=? ORDER BY rowid DESC LIMIT 20',actor));
  const cached=await d.getFirstAsync<{payload:string}>('SELECT payload FROM incoming_cache WHERE actor=?',actor);
  setIncoming(cached?JSON.parse(cached.payload):[]);
  if(online){
   const response=await supabase.from('shift_handovers').select('*').eq('incoming_guard_id',actor).order('submitted_at',{ascending:false}).limit(20);
   if(response.error)throw new Error(response.error.message);
   await d.runAsync('INSERT OR REPLACE INTO incoming_cache VALUES(?,?)',actor,JSON.stringify(response.data));setIncoming(response.data);
  }
 },[actor,online]);
 useEffect(()=>{void load().catch(e=>setError(String(e)));},[load]);
 async function queue(receive?:Incoming){
  if(busy)return;setBusy(true);setError('');
  try{
   const d=await db();
   if(receive||duty?.successor_shift_id){
    const id=receive?.id??Crypto.randomUUID();
    const args=receive?{p_id:id}:{p_id:id,p_shift_id:duty!.shift_id,p_incoming_shift_id:duty!.successor_shift_id,
     p_notes:notes.trim(),p_equipment:equipment.trim(),p_incident_ids:refs};
    await enqueueHandover(d,actor,receive?'receive':'submit',receive?.id??duty!.shift_id,args);
   }
   if(online)await syncRecords(actor);
   await onDelivered();await load();
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 return <View style={{gap:12}}>
  <SurfaceCard><Text>Outgoing handover · {duty?.post??'No assigned post'}</Text>
   {duty?.post&&duty.successor_shift_id?<>
    <TextInput accessibilityLabel="Handover notes" multiline placeholder="Notes for incoming guard" maxLength={3000} value={notes} onChangeText={setNotes}/>
    <TextInput accessibilityLabel="Equipment details" multiline placeholder="Equipment and condition" maxLength={3000} value={equipment} onChangeText={setEquipment}/>
    {incidents.filter(i=>i.site_id===duty.site_id&&!['closed','resolved'].includes(i.status)).map(i=>
     <SmartButton key={i.id} variant="secondary" label={(refs.includes(i.id)?'✓ ':'')+i.public_number} onPress={()=>setRefs(r=>r.includes(i.id)?r.filter(x=>x!==i.id):[...r,i.id])}/>)}
    <SmartButton label="Submit handover and end duty" disabled={busy||notes.trim().length<5} onPress={()=>void queue()}/>
   </>:<Text>An assigned incoming shift at this post is required. Follow approved handover procedures.</Text>}
  </SurfaceCard>
  <Text>Incoming handovers</Text>
  {incoming.map(h=><SurfaceCard key={h.id}><Text>{h.post} · {h.submitted_at}</Text><Text>Outgoing guard: {h.outgoing_guard_id}</Text><Text>{h.notes}</Text>
   <Text>Equipment: {h.equipment||'None recorded'}</Text><Text>Incident references: {h.incident_ids?.join(', ')||'None'}</Text>
   {h.accepted_at?<Text>Received {h.accepted_at} · {h.accepted_by??actor}</Text>:<SmartButton label="Acknowledge receipt" disabled={busy} onPress={()=>void queue(h)}/>}</SurfaceCard>)}
  {ops.map(o=><Text key={o.id}>{o.id.slice(0,8)} · {o.state==='received'?'Server received':o.state} {o.error}</Text>)}
  <SmartButton label="Refresh and retry" disabled={!online||busy} onPress={async()=>{try{await syncRecords(actor);await onDelivered();await load();}catch(e){setError(String(e));}}}/>
  {!!error&&<Text accessibilityRole="alert">{error}</Text>}
 </View>;
}
