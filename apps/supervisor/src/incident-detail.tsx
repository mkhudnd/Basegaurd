import {useEffect,useRef,useState} from 'react';
import {acknowledgeIncident,errorMessage,recordResponse,reviewHistory,type Incident,type Update} from './service';
import {Badge,label} from './ui';

const zone='Africa/Harare';
const dateFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
export const localDate=(v:string|number)=>dateFormatter.format(new Date(v));
export const time=(v:string)=>timeFormatter.format(new Date(v));
export const ref=(id:string|null)=>id?('…'+id.slice(-8)):'Unassigned';

export function IncidentDetail({incident,onRefresh}:{incident:Incident;onRefresh:()=>void}) {
  const [status,setStatus]=useState(incident.status);
  const [history,setHistory]=useState<Update[]|null>(null);
  const [historyError,setHistoryError]=useState('');
  const [version,setVersion]=useState(0);
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const lock=useRef(false);
  const pending=useRef<{id:string;action:'progress'|'resolved';note:string}|null>(null);
  useEffect(()=>{
    const request=new AbortController();
    setHistoryError('');
    void reviewHistory(incident.id,request.signal).then(rows=>{
      if(!request.signal.aborted)setHistory(rows);
    }).catch(e=>{if(!request.signal.aborted)setHistoryError(errorMessage(e,'Review history unavailable.'));});
    return ()=>request.abort();
  },[incident.id,version]);

  async function save(action:'acknowledge'|'progress'|'resolved') {
    if(lock.current)return;
    if(action==='acknowledge'&&!window.confirm('Confirm that you reviewed this incident. Use approved emergency procedures when immediate action is needed.'))return;
    lock.current=true;
    setBusy(true);setError('');setMessage('');
    try{
      if(action==='acknowledge'){
        setStatus(await acknowledgeIncident(incident.id));
        setMessage('Acknowledgement confirmed by the server.');
      }else{
        const trimmed=note.trim();
        if(trimmed.length<2||trimmed.length>1000)throw new Error('Enter a review note of 2 to 1,000 characters.');
        if(!pending.current||pending.current.action!==action||pending.current.note!==trimmed){
          pending.current={id:crypto.randomUUID(),action,note:trimmed};
        }
        await recordResponse(incident.id,pending.current.id,action,trimmed);
        pending.current=null;
        setStatus(action==='resolved'?'resolved':'in_progress');
        setNote('');
        setMessage('Incident response confirmed by the server.');
      }
      setVersion(v=>v+1);
      onRefresh();
    }catch(e){setError(errorMessage(e,'Unable to confirm the incident response.'));}
    finally{setBusy(false);lock.current=false;}
  }
  return <>
    <div className="detail-badges"><Badge value={incident.severity}/><Badge value={status==='reported'?'Needs review':status}/></div>
    <p>Reported {time(incident.reported_at)} · Received {time(incident.received_at)}</p>
    <p className="record-copy">{incident.description}</p>
    <h3>Review history</h3>
    {historyError?<p role="alert">{historyError}</p>:history===null?<p role="status">Loading review history…</p>:history.length?
      <ul className="history">{history.map(u=><li key={u.id}><strong>{label(u.update_type)}</strong><small>{time(u.created_at)} · Actor {ref(u.author_id)}</small><p>{u.note}</p></li>)}</ul>:<p>No review updates recorded.</p>}
    {status==='reported'&&<div className="modal-actions"><button className="btn primary" disabled={busy} onClick={()=>void save('acknowledge')}>Acknowledge</button></div>}
    {['acknowledged','in_progress'].includes(status)&&<>
      <label htmlFor="review-note">Follow-up or resolution note</label>
      <textarea id="review-note" className="field" maxLength={1000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/>
      <div className="modal-actions">
        <button className="btn" disabled={busy||note.trim().length<2} onClick={()=>void save('progress')}>Save follow-up</button>
        <button className="btn primary" disabled={busy||note.trim().length<2} onClick={()=>void save('resolved')}>Resolve incident</button>
      </div>
    </>}
    {busy&&<p role="status">Waiting for server confirmation…</p>}
    {message&&<p role="status" className="success">{message}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </>;
}
