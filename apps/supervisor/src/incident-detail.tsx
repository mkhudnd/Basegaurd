import {useEffect,useMemo,useRef,useState} from 'react';
import {acknowledgeIncident,errorMessage,isAuthError,loadIncidentContext,recordResponse,reviewHistory,supabase,type Incident,type IncidentContext,type Update} from './service';
import {canTransition,displayIncidentStatus} from './incident-domain';
import {Badge,Button,Icon,label} from './ui';

const zone='Africa/Harare';
const dateFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
export const localDate=(v:string|number)=>dateFormatter.format(new Date(v));
export const time=(v:string)=>timeFormatter.format(new Date(v));
export const ref=(id:string|null)=>id?('…'+id.slice(-8)):'Unavailable';

export function IncidentDetail({incident,siteName,reporterName,onRefresh,onClose}:{
  incident:Incident;siteName:string;reporterName?:string;onRefresh:()=>void;onClose?:()=>void;
}) {
  const [status,setStatus]=useState(incident.status);
  const [history,setHistory]=useState<Update[]|null>(null);
  const [context,setContext]=useState<IncidentContext|null>(null);
  const [loadError,setLoadError]=useState('');
  const [version,setVersion]=useState(0);
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [viewer,setViewer]=useState(false);
  const lock=useRef(false);
  const pending=useRef<{id:string;action:'progress'|'resolved';note:string}|null>(null);
  useEffect(()=>{
    const request=new AbortController();
    setLoadError('');setHistory(null);setContext(null);
    void Promise.all([reviewHistory(incident.id,request.signal),loadIncidentContext(incident,request.signal)])
      .then(([updates,details])=>{if(!request.signal.aborted){setHistory(updates);setContext(details);}})
      .catch(e=>{if(!request.signal.aborted){if(isAuthError(e))void supabase?.auth.signOut({scope:'local'});setLoadError(errorMessage(e,'Incident detail could not be loaded.'));}});
    return ()=>request.abort();
  },[incident.id,version]);

  const timeline=useMemo(()=>[
    {id:'reported',at:incident.reported_at,title:'Reported by guard',detail:'Incident event time'},
    {id:'received',at:incident.received_at,title:'Received by server',detail:'Confirmed server receipt'},
    ...(history??[]).map(update=>({id:update.id,at:update.created_at,title:label(update.update_type),detail:update.note+' · Actor '+ref(update.author_id)})),
  ].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),[history,incident]);

  async function save(action:'acknowledge'|'progress'|'resolved') {
    if(lock.current||!canTransition(status,action==='resolved'?'resolve':action))return;
    if(action==='acknowledge'&&!window.confirm('Confirm that you reviewed this incident. Use approved emergency procedures when immediate action is needed.'))return;
    lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      if(action==='acknowledge'){
        setStatus(await acknowledgeIncident(incident.id));setMessage('Acknowledgement confirmed by the server.');
      }else{
        const trimmed=note.trim();
        if(trimmed.length<2||trimmed.length>1000)throw new Error('Enter a review note of 2 to 1,000 characters.');
        if(!pending.current||pending.current.action!==action||pending.current.note!==trimmed){pending.current={id:crypto.randomUUID(),action,note:trimmed};}
        await recordResponse(incident.id,pending.current.id,action,trimmed);
        pending.current=null;setStatus(action==='resolved'?'resolved':'in_progress');setNote('');
        setMessage('Incident response confirmed by the server.');
      }
      setVersion(v=>v+1);onRefresh();
    }catch(e){if(isAuthError(e))void supabase?.auth.signOut({scope:'local'});setError(errorMessage(e,'Unable to confirm the incident response.'));}
    finally{setBusy(false);lock.current=false;}
  }

  return <div className="incident-detail">
    <div className="incident-detail-head"><div><span className="eyebrow">INCIDENT RECORD</span><h2>{incident.public_number}</h2></div>
      {onClose&&<Button className="icon-only" onClick={onClose} aria-label="Close incident details"><Icon name="close"/></Button>}
    </div>
    <div className="detail-badges"><Badge value={incident.severity}/><Badge value={displayIncidentStatus(status)}/></div>
    <dl className="incident-facts">
      <div><dt>Category</dt><dd>{label(incident.category)}</dd></div>
      <div><dt>Reporting guard</dt><dd title={incident.reporter_id}>{reporterName??ref(incident.reporter_id)}{!reporterName&&<small>Name unavailable until the personnel identity proposal is deployed</small>}</dd></div>
      <div><dt>Site</dt><dd>{siteName}</dd></div>
      <div><dt>Post</dt><dd>{context===null?'Loading…':context.post||'Not recorded'}</dd></div>
      <div><dt>Reported</dt><dd>{time(incident.reported_at)}</dd></div>
      <div><dt>Server received</dt><dd>{time(incident.received_at)}</dd></div>
    </dl>
    <section><h3>Description</h3><p className="record-copy">{incident.description}</p></section>
    <section><h3>Photographic evidence</h3>
      {context===null&&!loadError&&<p role="status">Loading evidence…</p>}
      {context?.evidence&&<button className="evidence-thumb" onClick={()=>setViewer(true)}><img src={context.evidence.signedUrl} alt={'Evidence for '+incident.public_number}/><span>Open photograph</span></button>}
      {context&&!context.evidence&&!context.evidenceUnavailable&&<p>No photograph is registered for this incident.</p>}
      {context?.evidenceUnavailable&&<p className="error" role="alert">{context.evidenceUnavailable} <button className="text-btn" onClick={()=>setVersion(v=>v+1)}>Retry</button></p>}
    </section>
    <section><h3>Incident location</h3>
      {typeof incident.latitude==='number'&&typeof incident.longitude==='number'?<IncidentPoint latitude={incident.latitude} longitude={incident.longitude}/>:<p>Coordinates were not recorded for this incident.</p>}
    </section>
    <section><h3>Supervisor response</h3>
      {status==='reported'&&<Button variant="primary" disabled={busy} onClick={()=>void save('acknowledge')}>Acknowledge incident</Button>}
      {['acknowledged','in_progress'].includes(status)&&<><label htmlFor="review-note">Follow-up or resolution note</label>
        <textarea id="review-note" className="field" maxLength={1000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/>
        <div className="modal-actions"><Button disabled={busy||note.trim().length<2} onClick={()=>void save('progress')}>Save follow-up</Button>
          <Button variant="primary" disabled={busy||note.trim().length<2} onClick={()=>void save('resolved')}>Resolve incident</Button></div></>}
      {status==='resolved'&&<p>Closing requires the proposed backend transition before it can be enabled.</p>}
      {status==='closed'&&<p>This incident is closed.</p>}
      {busy&&<p role="status">Waiting for server confirmation…</p>}{message&&<p role="status" className="success">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}
    </section>
    <section><h3>Lifecycle timeline</h3>
      {loadError?<p role="alert" className="error">{loadError} <button className="text-btn" onClick={()=>setVersion(v=>v+1)}>Retry</button></p>
        :<ol className="timeline">{timeline.map(item=><li key={item.id}><span/><div><strong>{item.title}</strong><small>{time(item.at)}</small><p>{item.detail}</p></div></li>)}</ol>}
    </section>
    {viewer&&context?.evidence&&<div className="image-viewer" role="dialog" aria-modal="true" aria-label="Incident photograph">
      <Button className="image-viewer-close" onClick={()=>setViewer(false)} aria-label="Close photograph"><Icon name="close"/></Button>
      <img src={context.evidence.signedUrl} alt={'Evidence for '+incident.public_number}/></div>}
  </div>;
}

function IncidentPoint({latitude,longitude}:{latitude:number;longitude:number}) {
  const target=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=target.current;if(!node)return;
    let map:import('maplibre-gl').Map|undefined;
    void import('maplibre-gl').then(({Map,Marker,NavigationControl})=>{
      map=new Map({container:node,style:import.meta.env.VITE_OPERATIONS_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/positron',center:[longitude,latitude],zoom:15,attributionControl:{compact:true}});
      map.addControl(new NavigationControl({showCompass:false}),'top-right');new Marker({color:'#B43732'}).setLngLat([longitude,latitude]).addTo(map);
    });
    return ()=>map?.remove();
  },[latitude,longitude]);
  return <><div className="incident-map" ref={target}/><small>{latitude.toFixed(6)}, {longitude.toFixed(6)}</small></>;
}
