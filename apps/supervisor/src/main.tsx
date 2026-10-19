import React, {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {type Session} from '@supabase/supabase-js';
import {acknowledgeIncident,authorizedSites,loadSiteFeed,supabase,type Site,type Incident,type Occurrence} from './service';
import './style.css';

type View='overview'|'incidents'|'occurrences';
const time=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Harare'});
const localDate=(v:string)=>new Date(v).toLocaleDateString('sv-SE',{timeZone:'Africa/Harare'});
function App(){
 const [session,setSession]=useState<Session|null>(null);const [init,setInit]=useState(true);
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const [sites,setSites]=useState<Site[]>([]);const [siteId,setSiteId]=useState('');
 const [incidents,setIncidents]=useState<Incident[]>([]);const [occurrences,setOccurrences]=useState<Occurrence[]>([]);
 const [view,setView]=useState<View>('overview');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const loadVersion=useRef(0);
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
 const filtered=useMemo(()=>occurrences.filter(o=>localDate(o.event_at)===date),[occurrences,date]);
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
 return <div className="shell"><aside className="sidebar">
  <div className="brand">◈ BASEGUARD <strong>SMARTOPS</strong></div><small>SUPERVISOR PORTAL · PILOT</small>
  <nav>{([['overview','Overview'],['incidents','Incident inbox'],['occurrences','Occurrence book']] as const).map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</nav>
  <div className="sidebar-end"><button className="outline" onClick={()=>supabase.auth.signOut()}>Sign out</button></div>
 </aside><main>
  <div className="topline"><div><p className="eyebrow">SECURITY OPERATIONS</p><h1>{view==='overview'?'Site overview':view==='incidents'?'Incident inbox':'Digital occurrence book'}</h1></div>
   <div className="actions"><label>Site <select value={siteId} onChange={e=>setSiteId(e.target.value)}>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <button className="outline" onClick={()=>void reload()} disabled={busy}>Refresh</button></div></div>
  {error&&<div role="alert" className="error">{error}</div>}
  {!sites.length?<section className="panel">No permitted sites. Ask your administrator to assign this account to a site.</section>:<>
   {view==='overview'&&<><div className="stats">
    <div className="stat"><span>Total reports</span><strong>{incidents.length}</strong><small>Most recent 100</small></div>
    <div className="stat"><span>Awaiting acknowledgement</span><strong>{incidents.filter(i=>i.status==='reported').length}</strong><small>Requires supervisor review</small></div>
    <div className="stat"><span>Open incidents</span><strong>{incidents.filter(i=>!['resolved','closed'].includes(i.status)).length}</strong><small>Not closed or resolved</small></div>
    <div className="stat"><span>OB records</span><strong>{occurrences.length}</strong><small>Most recent 200</small></div>
   </div><section className="panel"><h2>About this dashboard</h2><p>Current site: <b>{site?.name}</b>. Figures reflect the loaded record window, not all historical records. The pilot is a reporting tool, not an emergency-dispatch console.</p></section></>}
   {view==='incidents'&&<section className="panel"><div className="sectionHead"><h2>Recent incidents</h2><span className="muted">Limited to assigned sites</span></div>
    {incidents.length===0?<p>No incident reports have been received.</p>:<div className="tablewrap"><table><thead><tr><th>Reference</th><th>Category</th><th>Severity</th><th>Reported</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {incidents.map(i=><tr key={i.id}><td><strong>{i.public_number}</strong><div className="small">{i.description}</div></td><td>{i.category}</td><td><span className={'pill '+i.severity}>{i.severity}</span></td><td>{time(i.reported_at)}<div className="small">Server: {time(i.received_at)}</div></td><td>{i.status}</td>
     <td>{i.status==='reported'?<button onClick={()=>void acknowledge(i.id)}>Acknowledge</button>:<span className="muted">Recorded</span>}</td></tr>)}</tbody></table></div>}</section>}
   {view==='occurrences'&&<section className="panel"><div className="sectionHead"><h2>Occurrence report · {site?.name}</h2><div className="actions"><label>Date <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="outline" onClick={()=>window.print()}>Print / Save PDF</button></div></div>
    <p className="small">PDF export uses browser printing. All times displayed in Africa/Harare timezone. This first-sprint report excludes corrections and must not replace the official paper occurrence book.</p>
    {filtered.length===0?<p>No entries loaded for this date.</p>:<div className="tablewrap"><table><thead><tr><th>Event time</th><th>Category</th><th>Entry</th><th>Server received</th></tr></thead><tbody>{filtered.map(o=><tr key={o.id}><td>{time(o.event_at)}</td><td>{o.category}</td><td>{o.narrative}</td><td>{time(o.received_at)}</td></tr>)}</tbody></table></div>}</section>}
  </>}
  <footer>Baseguard SmartOps v0.1 · Prototype only · Emergency incidents must still be reported through approved channels.</footer>
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
