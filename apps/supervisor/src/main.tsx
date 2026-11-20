import React, {useEffect,useMemo,useRef,useState} from 'react';
import {missedCheckIn} from '../../guard/src/shift-coverage';
import {createRoot} from 'react-dom/client';
import {type Session} from '@supabase/supabase-js';
import {acknowledgeIncident,authorizedSites,loadSiteFeed,supabase,type Site,type Incident,type Occurrence} from './service';
import './style.css';

type View='overview'|'incidents'|'occurrences';
const time=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Harare'});
const localDate=(v:string)=>new Date(v).toLocaleDateString('sv-SE',{timeZone:'Africa/Harare'});
function ReviewHistory({incidentId}:{incidentId:string}){
 const [updates,setUpdates]=useState<{id:string;created_at:string;update_type:string;note:string}[]|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  let current=true;
  void supabase.from('incident_updates').select('id,created_at,update_type,note')
   .eq('incident_id',incidentId).order('created_at').then(({data,error})=>{
    if(!current)return;
    if(error)setError(error.message);
    else setUpdates(data??[]);
   });
  return ()=>{current=false;};
 },[incidentId]);
 return <section><h3>Review history</h3>{error?<p role="alert">{error}</p>:updates?.length?
  updates.map(u=><p key={u.id}>{time(u.created_at)} · {u.update_type} · {u.note}</p>):
  <p>{updates?'No updates recorded.':'Loading review history…'}</p>}</section>;
}
function App(){
 const [expandedCases,setExpandedCases]=useState<Set<string>>(new Set());
 const [session,setSession]=useState<Session|null>(null);const [init,setInit]=useState(true);
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const [sites,setSites]=useState<Site[]>([]);const [siteId,setSiteId]=useState('');
 const [incidents,setIncidents]=useState<Incident[]>([]);const [occurrences,setOccurrences]=useState<Occurrence[]>([]);
 const [view,setView]=useState<View>('overview');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const loadVersion=useRef(0);
 const [coverage,setCoverage]=useState<{site:string;rows:import('./service').HomeShift[]}|null>(null);
 const [coverageError,setCoverageError]=useState('');
 const [refreshKey,setRefreshKey]=useState(0);
 const [handovers,setHandovers]=useState<{id:string;site_id:string;notes:string;post:string|null;submitted_at:string;incoming_guard_id:string|null}[]>([]);
 useEffect(()=>{
  let current=true;
  setCoverage(null);setHandovers([]);setCoverageError('');
  if(view==='overview' && session && sites.some(s=>s.id===siteId)){
   void supabase.from('shift_handovers').select('id,site_id,notes,post,submitted_at,incoming_guard_id').eq('site_id',siteId).is('accepted_at',null)
    .order('submitted_at',{ascending:false}).then(({data,error})=>{if(current){if(error)setCoverageError(error.message);else setHandovers(data??[]);}});
   void supabase.from('shifts').select('*')
    .eq('site_id',siteId).in('status',['active','scheduled']).order('started_at',{ascending:false}).limit(200)
    .then(({data,error})=>{if(current){if(error)setCoverageError(error.message);else setCoverage({site:siteId,rows:data??[]});}});
  }
  return ()=>{current=false;};
 },[view,session?.user.id,sites,siteId,refreshKey]);
 const rows=coverage?.site===siteId?coverage.rows:null;
 const urgent=incidents.filter(i=>i.site_id===siteId && i.status==='reported').sort((a,b)=>Number(['high','critical'].includes(b.severity))-Number(['high','critical'].includes(a.severity)));
 const [date,setDate]=useState(localDate(new Date().toISOString()));
 useEffect(()=>{
  const {data:subscription}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
  supabase.auth.getSession().then(({data})=>setSession(data.session))
   .catch(e=>setError(e instanceof Error?e.message:'Session check failed'))
   .finally(()=>setInit(false));
  return ()=>subscription.subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  if(!session){loadVersion.current++;setSites([]);setSiteId('');setIncidents([]);setOccurrences([]);return;}
  let active=true;
  void authorizedSites(session.user.id).then(data=>{
   if(!active)return;
   setError('');setSites(data);setSiteId(current=>data.some(s=>s.id===current)?current:(data[0]?.id??''));
  }).catch(e=>{if(active){setError(e instanceof Error?e.message:'Site access failed');setSites([]);setSiteId('');}});
  return ()=>{active=false;};
 },[session?.user.id]);
 async function reload(){if(!siteId)return;const version=++loadVersion.current;setBusy(true);setError('');
  try{const feed=await loadSiteFeed(siteId);if(version===loadVersion.current){setIncidents(feed.incidents);setOccurrences(feed.occurrences);}}
  catch(e){if(version===loadVersion.current)setError(e instanceof Error?e.message:'Unable to load records');}
  finally{if(version===loadVersion.current)setBusy(false);}
 }
 useEffect(()=>{loadVersion.current++;setIncidents([]);setOccurrences([]);void reload();},[siteId]);
 const filtered=useMemo(()=>occurrences.filter(o=>!date||localDate(o.event_at)===date),[occurrences,date]);
 const site=sites.find(s=>s.id===siteId);
 async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');
  try{const {error:e2}=await supabase.auth.signInWithPassword({email:email.trim(),password});
   if(e2)throw e2;}
  catch(e){setError(e instanceof Error?e.message:'Sign-in failed');}
  finally{setBusy(false);}
 }
 async function acknowledge(id:string){
  if(!window.confirm('Confirm that you have reviewed this incident? This is not a substitute for emergency action.'))return;
  setBusy(true);setError('');
  try{await acknowledgeIncident(id);await reload();}
  catch(e){setError(e instanceof Error?e.message:'Acknowledgement failed');}
  finally{setBusy(false);}
 }
 if(init)return <div className="center">Loading SmartOps…</div>;
 if(!session)return <div className="login-shell"><form className="login" onSubmit={signIn}>
  <div className="brand">◈ BASEGUARD <strong>SMARTOPS</strong></div><h1>Supervisor sign in</h1>
  <p>Company-provisioned accounts only.</p><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
  <label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
  <button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>{error&&<div role="alert" className="error">{error}</div>}
 </form></div>;
 return <div className={view==='overview'?'shell homeShell':'shell'}>
  {view==='overview'&&<header className="homeBrand"><span className="brandShield" aria-hidden="true"><img alt="" src={new URL('../../guard/assets/brand-shield.png',import.meta.url).href}/></span><div>Baseguard SmartOps<small>Supervisor workspace</small></div></header>}
  <aside className="sidebar">
  <div className="brand">◈ BASEGUARD <strong>SMARTOPS</strong></div><small>SUPERVISOR PORTAL · PILOT</small>
  <nav>{([['overview','Overview'],['incidents','Incident inbox'],['occurrences','Occurrence book']] as const).map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</nav>
  <div className="sidebar-end"><button className="outline" onClick={()=>supabase.auth.signOut()}>Sign out</button></div>
 </aside><main>
  <div className="topline"><div>{view!=='overview'&&<p className="eyebrow">SECURITY OPERATIONS</p>}<h1>{view==='overview'?'Overview':view==='incidents'?'Incident inbox':'Digital occurrence book'}</h1>{view==='overview'&&<small>{new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</small>}</div>
   <div className="actions"><label>Site <select value={siteId} onChange={e=>setSiteId(e.target.value)}>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <button className="outline" onClick={()=>{setRefreshKey(k=>k+1);void reload();}} disabled={busy}>Refresh</button></div></div>
  {error&&<div role="alert" className="error">{error}</div>}
  {!sites.length?<section className="panel">No permitted sites. Ask your administrator to assign this account to a site.</section>:<>
   {view==='overview'&&<>
    <h2>Needs attention</h2>
    {urgent.map(i=><details key={i.id} className="urgentCase" onToggle={event=>{
      const open=event.currentTarget.open;
      setExpandedCases(previous=>{const next=new Set(previous);if(open)next.add(i.id);else next.delete(i.id);return next;});
    }}><summary><span><strong>{i.severity} incident needs acknowledgement</strong><small>{i.public_number} · {i.category} · Received {time(i.received_at)}</small></span><b>Review incident</b></summary>
      <p>{i.category} · {i.severity} · Received {time(i.received_at)}</p><p>{i.description}</p>
      {expandedCases.has(i.id)&&<ReviewHistory incidentId={i.id}/>}
      <button disabled={busy} onClick={()=>void acknowledge(i.id)}>Acknowledge</button></details>)}
    {rows?.filter(s=>missedCheckIn(s)).map(s=><details className="panel" key={s.id}><summary>Missed check-in · {s.post??site?.name}</summary><p>Guard {s.guard_id} · Scheduled {time(s.started_at)}</p></details>)}
    {handovers.filter(h=>h.site_id===siteId&&(h.incoming_guard_id||!h.post||!rows?.some(s=>s.status==='active'&&s.post===h.post&&s.presence_status==='on_duty'))).map(h=><details className="panel" key={h.id}><summary>{h.incoming_guard_id?'Pending handover':'Coverage gap · no incoming guard'} · {time(h.submitted_at)}</summary><p>{h.notes}</p><small>Post: {h.post??'Unassigned'} · Assigned recipient: {h.incoming_guard_id??'Unassigned'}</small></details>)}
    <div className="stats"><div className="stat"><strong>{rows?new Set(rows.filter(s=>s.status==='active'&&s.presence_status==='on_duty'&&(!s.ended_at||Date.parse(s.ended_at)>Date.now())).map(s=>s.guard_id)).size:'—'}</strong>Guards on duty</div>
    <div className="stat"><strong>{rows?rows.filter(s=>missedCheckIn(s)).length:'—'}</strong>Missed check-ins<small>Scheduled shift currently due</small></div>
    <div className="stat"><strong>{incidents.filter(i=>i.site_id===siteId&&!['closed','resolved'].includes(i.status)).length}</strong>Open incidents</div></div>
    <section className="panel"><h2>Guard assignments</h2>{coverageError?<p role="alert">{coverageError}</p>:rows?.length?<div className="tablewrap"><table><thead><tr><th>Post</th><th>Guard reference</th><th>Duty status</th><th>Scheduled start</th><th>Confirmed check-in</th></tr></thead><tbody>{rows.map(s=><tr key={s.id}><td>{s.post??'Unassigned'}</td><td>{s.guard_id.slice(-8)}</td><td>{s.status==='scheduled'?'Scheduled':s.presence_status?.replace('_',' ')??'Unknown'}</td><td>{time(s.started_at)}</td><td>{s.checked_in_at?time(s.checked_in_at):'—'}</td></tr>)}</tbody></table></div>:<p>{rows?'No assignments in the loaded shifts.':'Loading assignments…'}</p>}</section>
    <section className="panel"><div className="sectionHead"><h2>Recent occurrence book entries</h2><button className="outline" onClick={()=>setView('occurrences')}>Open occurrence book</button></div>
    {occurrences.filter(o=>o.site_id===siteId).slice(0,3).map(o=><p key={o.id}><b>{o.category}</b> · {time(o.event_at)}<br/>{o.narrative}</p>)}
    {!occurrences.some(o=>o.site_id===siteId)&&<p>{busy?'Loading entries…':'No entries received.'}</p>}</section></>}
   {view==='incidents'&&<section className="panel"><div className="sectionHead"><h2>Recent incidents</h2><span className="muted">Limited to assigned sites</span></div>
    {incidents.length===0?<p>No incident reports have been received.</p>:<div className="tablewrap"><table><thead><tr><th>Reference</th><th>Category</th><th>Severity</th><th>Reported</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {incidents.map(i=><tr key={i.id}><td><strong>{i.public_number}</strong><div className="small">{i.description}</div></td><td>{i.category}</td><td><span className={'pill '+i.severity}>{i.severity}</span></td><td>{time(i.reported_at)}<div className="small">Server: {time(i.received_at)}</div></td><td>{i.status}</td>
     <td>{i.status==='reported'?<button onClick={()=>void acknowledge(i.id)}>Acknowledge</button>:<span className="muted">Recorded</span>}</td></tr>)}</tbody></table></div>}</section>}
   {view==='occurrences'&&<section className="panel"><div className="sectionHead"><h2>Occurrence report · {site?.name}</h2><div className="actions"><button className="outline" onClick={()=>setDate(localDate(new Date().toISOString()))}>Today</button><button className="outline" onClick={()=>setDate('')}>All entries</button><label>Date <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="outline" onClick={()=>window.print()}>Print / Save PDF</button></div></div>
    <p className="small">PDF export uses browser printing. All times displayed in Africa/Harare timezone. This first-sprint report excludes corrections and must not replace the official paper occurrence book.</p>
    {filtered.length===0?<p>No entries loaded for this date.</p>:<div className="tablewrap"><table><thead><tr><th>Event time</th><th>Category</th><th>Entry</th><th>Server received</th></tr></thead><tbody>{filtered.map(o=><tr key={o.id}><td>{time(o.event_at)}</td><td>{o.category}</td><td>{o.narrative}</td><td>{time(o.received_at)}</td></tr>)}</tbody></table></div>}</section>}
  </>}
  <footer>Baseguard SmartOps v0.1 · Prototype only · Emergency incidents must still be reported through approved channels.</footer>
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
