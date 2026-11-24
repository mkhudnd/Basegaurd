import {useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {type Session} from '@supabase/supabase-js';

import {authorizedWorkspace,errorMessage,loadRecords,supabase,type Feed,type Handover,type Incident,type Occurrence,type Profile,type Shift,type Site} from './service';
import {IncidentDetail,localDate,ref,time} from './incident-detail';
import {Badge,Button,Card,Dialog,Icon,Input,Metrics,Select,Table,label,navigation,type Page} from './ui';
import {OperationsMap} from './operations-map';
import './style.css';

type Resource<T> = {state:'loading'}|{state:'error';error:string}|{state:'ready';rows:T};
type Resources = {[K in keyof Feed]:Resource<Feed[K]>};
const feedKeys=['incidents','occurrences','shifts','handovers'] as const;
const loading:Resources={incidents:{state:'loading'},occurrences:{state:'loading'},shifts:{state:'loading'},handovers:{state:'loading'}};
const ready=<T,>(resource:Resource<T>)=>resource.state==='ready'?resource.rows:undefined;
type Detail = {kind:'incident';row:Incident}|{kind:'occurrence';row:Occurrence}|{kind:'handover';row:Handover}|{kind:'shift';row:Shift};
const open=(row:Incident)=>!['closed','resolved'].includes(row.status);
const isOnDuty=(row:Shift,now:number)=>row.status==='active'&&row.presence_status==='on_duty'&&Date.parse(row.started_at)<=now&&(!row.ended_at||Date.parse(row.ended_at)>now);
function missedCheckIn(row:Shift,now:number) {
  // An open-ended scheduled shift is due only on its scheduled local day.
  return row.status==='scheduled'&&!row.checked_in_at&&Date.parse(row.started_at)<=now&&
    (row.ended_at?Date.parse(row.ended_at)>now:localDate(row.started_at)===localDate(now));
}
const shiftStatus=(row:Shift,now:number)=>missedCheckIn(row,now)?'Missed check-in':row.status==='active'?row.presence_status??'Active shift':row.status;
const handoverStatus=(row:Handover)=>row.accepted_at?'Acknowledged':row.incoming_guard_id?'Pending':'No recipient assigned';
const incidentStatus=(row:Incident)=>row.status==='reported'?'Needs review':label(row.status);

function Source<T>({resource,children}:{resource:Resource<T>;children:(rows:T)=>ReactNode}) {
  if(resource.state==='loading')return <p className="empty" role="status">Loading records…</p>;
  if(resource.state==='error')return <p className="empty error" role="alert">Records unavailable. {resource.error}</p>;
  return children(resource.rows);
}

function SignIn({initialError}:{initialError:string}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(initialError);
  async function signIn(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!supabase)return;
    const values=new FormData(e.currentTarget);
    setBusy(true);setError('');
    try {
      const {error}=await supabase.auth.signInWithPassword({email:String(values.get('email')).trim(),password:String(values.get('password'))});
      if(error)throw error;
    }catch(e){setError(errorMessage(e,'Sign-in failed.'));}
    finally{setBusy(false);}
  }
  return <div className="login-shell"><form className="card login" onSubmit={signIn}>
    <div className="login-brand"><span className="metric-icon"><Icon name="shield"/></span> Baseguard SmartOps</div>
    <h1>Supervisor sign in</h1><p>Use your company-provisioned account.</p>
    <label>Work email<Input name="email" type="email" autoComplete="username" required/></label>
    <label>Password<Input name="password" type="password" autoComplete="current-password" required/></label>
    <Button type="submit" variant="primary" disabled={busy||!supabase}>{busy?'Signing in…':'Sign in'}</Button>
    {!supabase&&<p role="alert" className="error">Supabase configuration is missing. Set the supervisor app’s URL and publishable key.</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </form></div>;
}

function App(){
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(Boolean(supabase));
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!supabase)return;
    const {data}=supabase.auth.onAuthStateChange((_event,current)=>{setSession(current);setLoading(false);});
    void supabase.auth.getSession().then(({error})=>{
      if(error){setError(error.message);setLoading(false);}
    }).catch(e=>{setError(errorMessage(e,'Session check failed.'));setLoading(false);});
    return ()=>data.subscription.unsubscribe();
  },[]);
  if(loading)return <div className="login-shell"><p role="status" className="card empty">Loading SmartOps…</p></div>;
  return session?<Workspace key={session.user.id} session={session}/>:<SignIn initialError={error} key={error}/>;
}

function Workspace({session}:{session:Session}){
  const [access,setAccess]=useState<{profile:Profile;sites:Site[]}|null>(null);
  const [accessError,setAccessError]=useState('');
  const [userRefresh,setUserRefresh]=useState(0);
  const [records,setRecords]=useState<{scope:string;data:Resources}>({scope:'',data:loading});
  const [siteId,setSiteId]=useState('');
  const [version,setVersion]=useState(0);
  const [page,setPage]=useState<Page>('overview');
  const [menu,setMenu]=useState(false);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('');
  const [date,setDate]=useState('');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [signOutError,setSignOutError]=useState('');
  const [signingOut,setSigningOut]=useState(false);
  const [now,setNow]=useState(Date.now);
  const scope=JSON.stringify([userRefresh,siteId,version]);
  const data=records.scope===scope?records.data:loading;
  const refresh=()=>{setNow(Date.now());setVersion(v=>v+1);};

  useEffect(()=>{
    const request=new AbortController();
    void authorizedWorkspace(session.user.id,request.signal).then(result=>{
      if(request.signal.aborted)return;
      setSiteId(previous=>result.sites.some(s=>s.id===previous)?previous:'');
      setAccess(result);
    }).catch(e=>{if(!request.signal.aborted)setAccessError(errorMessage(e,'Workspace access unavailable.'));});
    return ()=>request.abort();
  },[session.user.id,userRefresh]);

  useEffect(()=>{
    if(!access?.sites.length)return;
    const request=new AbortController();
    setRecords({scope,data:loading});
    const load=async <K extends keyof Feed>(kind:K)=>{
      let result:Resource<Feed[K]>;
      try {
        const rows=await loadRecords(kind,siteId,request.signal);
        const allowed=new Set(access.sites.map(s=>s.id));
        result={state:'ready',rows:rows.filter(row=>allowed.has(row.site_id)) as Feed[K]};
      }catch(e){result={state:'error',error:errorMessage(e,'Unable to load this data source.')};}
      if(!request.signal.aborted)setRecords(previous=>previous.scope===scope?{scope,data:{...previous.data,[kind]:result}}:previous);
    };
    for(const kind of feedKeys)void load(kind);
    return ()=>request.abort();
  },[access,scope,siteId]);

  useEffect(()=>{
    if(!menu)return;
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};
    window.addEventListener('keydown',escape);
    return ()=>window.removeEventListener('keydown',escape);
  },[menu]);

  function go(next:Page){
    setPage(next);setMenu(false);setSearch('');setFilter('');setDate('');setDetail(null);
    window.scrollTo(0,0);
  }
  function chooseSite(id:string){
    setSiteId(id);setDetail(null);setFilter('');setNow(Date.now());
  }
  async function signOut(){
    if(!supabase)return;
    setSignOutError('');setSigningOut(true);
    try{const {error}=await supabase.auth.signOut();if(error)throw error;}
    catch(e){setSignOutError(errorMessage(e,'Sign-out failed.'));}
    finally{setSigningOut(false);}
  }
  function reloadWorkspace(){
    setAccess(null);setAccessError('');setDetail(null);setUserRefresh(k=>k+1);setNow(Date.now());
  }

  const [ ,navLabel,title,subtitle]=navigation.find(item=>item[0]===page)!;
  const sites=access?.sites??[];
  const selectedSites=sites.filter(s=>!siteId||s.id===siteId);
  const siteName=(id:string)=>sites.find(s=>s.id===id)?.name??'Site unavailable';
  const initials=access?.profile.display_name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()??'';
  const shifts=ready(data.shifts),incidents=ready(data.incidents),handovers=ready(data.handovers);
  const coverageAvailable=shifts?.every(s=>'presence_status' in s);
  const duty=coverageAvailable?shifts?.filter(s=>isOnDuty(s,now)):undefined;
  const missed=shifts?.every(s=>'checked_in_at' in s)?shifts?.filter(s=>missedCheckIn(s,now)):undefined;
  const urgent=incidents?.filter(s=>s.status==='reported').sort((a,b)=>Number(['critical','high'].includes(b.severity))-Number(['critical','high'].includes(a.severity)));
  const pending=handovers?.filter(h=>!h.accepted_at);
  const matches=(values:string[],status:string,event:string)=>
    (!filter||status===filter)&&(!date||localDate(event)===date)&&values.some(v=>v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const mapSites=useMemo(()=>access?.sites.filter(s=>!siteId||s.id===siteId)??[],[access,siteId]);
  const incidentSites=useMemo(()=>incidents&&new Set(incidents.filter(i=>open(i)&&['critical','high'].includes(i.severity)).map(i=>i.site_id)),[incidents]);
  const busy=Boolean(access?.sites.length)&&feedKeys.some(k=>data[k].state==='loading');
  const attention = [
    ...(urgent??[]).map(row=>({id:row.id,title:'Incident needs acknowledgement',note:row.public_number+' · '+label(row.category)+' · '+time(row.received_at),kind:'incident' as const,icon:'incidents' as const,tone:'red',row})),
    ...(missed??[]).map(row=>({id:row.id,title:'Missed check-in',note:(row.post??siteName(row.site_id))+' · '+time(row.started_at),kind:'shift' as const,icon:'clock' as const,tone:'',row})),
    ...(pending??[]).filter(row=>row.incoming_guard_id||!row.post||!duty?.some(s=>s.site_id===row.site_id&&s.post===row.post)).map(row=>({id:row.id,title:row.incoming_guard_id?'Pending handover':'Handover without assigned relief',note:(row.post??siteName(row.site_id))+' · '+time(row.submitted_at),kind:'handover' as const,icon:'handovers' as const,tone:'green',row})),
  ];

  const filters=(options:string[],showDate=true)=><div className="filters">
    <Input type="search" aria-label="Search records" placeholder="Search records…" value={search} onChange={e=>setSearch(e.target.value)}/>
    {options.length>0&&<Select aria-label="Filter records by status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{options.map(v=><option key={v}>{v}</option>)}</Select>}
    {showDate&&<><Input type="date" aria-label="Filter records by date" value={date} onChange={e=>setDate(e.target.value)}/><button className="btn" onClick={()=>setDate(localDate(now))}>Today</button></>}
    {date&&showDate&&<button className="btn" onClick={()=>setDate('')}>Clear date</button>}
  </div>;

  function incidentTable(rows:Incident[], all=false){
    const visible=all?rows.filter(r=>matches([r.public_number,r.description,r.category,siteName(r.site_id),r.severity],incidentStatus(r),r.reported_at)):rows.slice(0,5);
    return <Table name="Incidents" heads={['Incident','Site','Priority','Status','Reported']} rows={visible.map(row=>({id:row.id,cells:[
      <><button className="text-btn record-link" onClick={()=>setDetail({kind:'incident',row})}>{row.public_number}</button><span className="sub">{label(row.category)}</span></>,siteName(row.site_id),<Badge value={row.severity}/>,
      <Badge value={incidentStatus(row)}/>,time(row.reported_at),
    ]}))}/>;
  }
  function shiftTable(rows:Shift[],filtered=true){
    const visible=filtered?rows.filter(r=>matches([r.guard_id,r.post??'',siteName(r.site_id)],label(shiftStatus(r,now)),r.started_at)):rows;
    return <Table name="Shift assignments" heads={['Guard reference','Site / post','Scheduled start','Confirmed check-in','Status']} rows={visible.map(row=>({id:row.id,cells:[
      <button className="text-btn" title={row.guard_id} onClick={()=>setDetail({kind:'shift',row})}>{ref(row.guard_id)}</button>,
      <><strong>{siteName(row.site_id)}</strong><span className="sub">{row.post??'Post unavailable'}</span></>,time(row.started_at),
      row.checked_in_at?time(row.checked_in_at):'checked_in_at' in row?'Not recorded':'Unavailable',<Badge value={shiftStatus(row,now)}/>,
    ]}))}/>;
  }
  function coverageRows(){
    return <div className="coverage">{selectedSites.map(s=>{
      const onDuty=duty?.filter(r=>r.site_id===s.id);
      const count=onDuty&&new Set(onDuty.map(r=>r.guard_id)).size;
      const gaps=missed?.filter(r=>r.site_id===s.id).length;
      return <div className="site-row" key={s.id}>
        <span className="site-icon"><Icon name="sites"/></span><span className="site-name"><strong>{s.name}</strong><small>{s.code}</small></span>
        <span className="site-count">{count===undefined?'Duty unavailable':count+' on duty'}</span>
        <Badge value={gaps?'Missed check-in':count?'On duty':count===0?'No on-duty guard':'Unavailable'}/>
      </div>;
    })}</div>;
  }
  const dashboardMetrics=[
    {title:'Guards on duty',value:duty&&new Set(duty.map(s=>s.guard_id)).size,note:'Confirmed on-duty status',icon:'guards'},
    {title:'Sites staffed',value:duty&&new Set(duty.map(s=>s.site_id)).size+' / '+selectedSites.length,note:'At least one guard on duty',icon:'sites'},
    {title:'Open incidents',value:incidents?.filter(open).length,note:'Review and follow up',icon:'incidents'},
    {title:'Pending handovers',value:pending?.length,note:'Awaiting acknowledgement or relief',icon:'handovers'},
  ] as const;
  const activity:{label:string;at:string;detail:Detail}[] = [
    ...(ready(data.occurrences)??[]).map(row=>({label:'Occurrence · '+label(row.category),at:row.event_at,detail:{kind:'occurrence' as const,row}})),
    ...(handovers??[]).map(row=>({label:'Handover submitted',at:row.submitted_at,detail:{kind:'handover' as const,row}})),
    ...(shifts??[]).flatMap(row=>row.checked_in_at?[{label:'Guard checked in',at:row.checked_in_at,detail:{kind:'shift' as const,row}}]:[]),
  ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const days=Array.from({length:7},(_,i)=>localDate(now-(6-i)*86400000));
  const dayTotals=incidents&&days.map(day=>incidents.filter(r=>localDate(r.reported_at)===day).length);

  return <div className="app">
    <header className="topbar"><div className="header-left">
      <button className="iconbutton mobile-menu" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} aria-controls="workspace-nav" onClick={()=>setMenu(v=>!v)}><Icon name={menu?'close':'menu'}/></button>
      <span className="top-brand" aria-label="Baseguard">B</span><div className="crumb">Baseguard <span>›</span> <b>{navLabel}</b></div>
    </div><div className="top-right"><span className="date">{new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Harare',dateStyle:'full'}).format(now)}</span>
      <span className="workspace-pill"><span className="dot"/> Supervisor workspace</span>
      {initials&&<button className="avatar avatar-button" aria-label="Account settings" onClick={()=>go('settings')}>{initials}</button>}
    </div></header>
    {menu&&<button aria-label="Dismiss navigation" className="nav-overlay" onClick={()=>setMenu(false)}/>}
    <aside className={'sidebar'+(menu?' open':'')} id="workspace-nav"><nav aria-label="Supervisor sections">
      {navigation.map(([id,name])=><button key={id} className={'nav-btn'+(page===id?' active':'')} aria-current={page===id?'page':undefined} onClick={()=>go(id)}>
        <span className="ico"><Icon name={id}/></span>{name}
        {id==='incidents'&&Boolean(urgent?.length)&&<span className="nav-badge">{urgent?.length}</span>}
      </button>)}
    </nav><div className="sidebar-bottom"><button className="iconbutton rail-signout" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={()=>void signOut()}><Icon name="logout"/></button></div></aside>
    <main className="main"><div className="content">
      <div className="heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">
        {page==='overview'&&<button className="btn secondary" onClick={()=>go('analytics')}><Icon name="analytics"/> View analytics</button>}
        {(page!=='settings'||accessError)&&<Button variant="primary" onClick={reloadWorkspace}><Icon name="refresh"/> Refresh</Button>}
        {page==='occurrence'&&<button className="btn" disabled={data.occurrences.state!=='ready'} onClick={()=>window.print()}>Print / Save PDF</button>}
      </div></div>
      <div className="notice"><Icon name="shield"/><span>Site access is limited to your assignments.</span>
        {sites.length>0&&page!=='settings'&&<label className="site-select">Site <Select value={siteId} onChange={e=>chooseSite(e.target.value)}><option value="">All permitted sites</option>{sites.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</Select></label>}
      </div>
      {accessError&&<p className="error" role="alert">{accessError}</p>}
      {signOutError&&<p className="error" role="alert">{signOutError}</p>}
      {!access&&!accessError&&<p className="empty" role="status">Checking workspace access…</p>}
      {access&&!sites.length&&page!=='settings'&&<Card title="No permitted sites"><p className="empty">Ask your administrator to verify your site assignments.</p></Card>}
      {access&&page==='settings'&&<Card title="Profile" subtitle="Authenticated workspace account">
        <div className="settings-row"><div><strong>{access.profile.display_name}</strong><p>{session.user.email} · {label(access.profile.role)}</p></div><span className="avatar">{initials}</span></div>
        <div className="settings-row"><div><strong>Site access</strong><p>{sites.length?sites.map(s=>s.name).join(', '):'No permitted sites.'}</p></div></div>
        <div className="settings-row"><div><strong>Session</strong><p>Sign out of this workspace on this device.</p></div><button className="btn" disabled={signingOut} onClick={()=>void signOut()}>{signingOut?'Signing out…':'Sign out'}</button></div>
      </Card>}
      {!!sites.length&&<>
        {busy&&<span className="sr-only" role="status">Refreshing workspace records.</span>}
        {page==='overview'&&<>
          <Metrics items={[...dashboardMetrics]}/>
          <OperationsMap sites={mapSites} incidentSites={incidentSites} onSelectSite={chooseSite}/>
          <div className="grid">
            <Card title="Site coverage" subtitle="Confirmed guard presence by site" action={<button className="text-btn" onClick={()=>go('sites')}>View all sites <Icon name="arrow"/></button>}>
              {coverageRows()}
            </Card>
            <Card title="Needs attention" subtitle="Incidents, check-ins and handovers">
              {(data.incidents.state==='error'||data.handovers.state==='error'||data.shifts.state==='error'||(shifts&&!missed))&&<p className="inline-note" role="status">Some attention sources are unavailable.</p>}
              <div className="attention">{attention.slice(0,6).map(a=><button className="att-row" key={a.kind+a.id} onClick={()=>setDetail(a)}>
                <span className={'att-icon '+a.tone}><Icon name={a.icon}/></span><span><strong>{a.title}</strong><small>{a.note}</small></span>
              </button>)}{!attention.length&&<p className="empty">{busy?'Loading items…':urgent&&missed&&pending?'No items need attention.':'Attention data is incomplete.'}</p>}</div>
            </Card>
          </div>
          <Card className="lower" title="Recent incidents" subtitle="Latest reports received from the field" action={<button className="text-btn" onClick={()=>go('incidents')}>View all incidents <Icon name="arrow"/></button>}>
            <Source resource={data.incidents}>{rows=>incidentTable(rows)}</Source>
          </Card>
          <Card className="lower" title="Recent operational activity" subtitle="Latest occurrence entries, handovers and confirmed check-ins">
            {feedKeys.filter(k=>k!=='incidents').some(k=>data[k].state==='error')&&<p className="inline-note" role="status">Some activity sources are unavailable.</p>}
            {feedKeys.filter(k=>k!=='incidents').some(k=>data[k].state==='loading')&&<p className="inline-note" role="status">Loading activity sources…</p>}
            {activity.length>0?<Table name="Recent operational activity" heads={['Activity','Site','Time','Action']} rows={activity.slice(0,6).map(item=>({
              id:item.detail.kind+item.detail.row.id,
              cells:[item.label,siteName(item.detail.row.site_id),time(item.at),<button className="text-btn" onClick={()=>setDetail(item.detail)}>Open record</button>],
            }))}/>:data.occurrences.state==='ready'&&data.handovers.state==='ready'&&data.shifts.state==='ready'&&<p className="empty">No operational activity recorded.</p>}
          </Card>
        </>}
        {page==='incidents'&&<Card className="listing" title="Incident register" subtitle="Filter by report date in Africa/Harare">
          {filters(['Needs review','Acknowledged','In progress','Resolved','Closed'])}<Source resource={data.incidents}>{rows=>incidentTable(rows,true)}</Source>
        </Card>}
        {page==='occurrence'&&<Card className="listing" title="Occurrence register" subtitle="Filter by event date in Africa/Harare">
          {filters([])}<Source resource={data.occurrences}>{rows=><Table name="Occurrence book" heads={['Event time','Category','Entry','Site','Server received','Action']}
            rows={rows.filter(r=>matches([r.category,r.narrative,siteName(r.site_id)],'',r.event_at)).map(row=>({id:row.id,cells:[
              time(row.event_at),label(row.category),<span className="record-copy">{row.narrative}</span>,siteName(row.site_id),time(row.received_at),<button className="text-btn" onClick={()=>setDetail({kind:'occurrence',row})}>Open entry</button>,
            ]}))}/>}</Source><p className="inline-note">This report excludes amendments. Follow your approved occurrence-book procedures.</p>
        </Card>}
        {page==='shifts'&&<div className="listing"><Metrics items={[
          dashboardMetrics[0],{title:'Scheduled',value:shifts?.filter(s=>s.status==='scheduled'&&Date.parse(s.started_at)>now).length,note:'Upcoming shift records',icon:'clock'},
          {title:'Missed check-ins',value:missed?.length,note:'Scheduled shifts currently due',icon:'warning'},
          {title:'Guards in roster',value:shifts&&new Set(shifts.map(s=>s.guard_id)).size,note:'Distinct guards on visible shifts',icon:'guards'},
        ]}/><Card title="Shift roster" subtitle="Scheduled assignments and recorded check-ins">
          {filters(['On duty','On break','Active shift','Scheduled','Missed check-in','Completed','Cancelled'])}
          <Source resource={data.shifts}>{rows=>shiftTable(rows)}</Source>
        </Card></div>}
        {page==='handovers'&&<Card className="listing" title="Handover register" subtitle="Acknowledgement is based on the recorded server timestamp">
          {filters(['Pending','Acknowledged','No recipient assigned'])}<Source resource={data.handovers}>{rows=><Table name="Shift handovers" heads={['Site / post','Outgoing guard','Incoming guard','Submitted','Status','Action']}
            rows={rows.filter(r=>matches([siteName(r.site_id),r.post??'',r.notes,r.outgoing_guard_id,r.incoming_guard_id??''],handoverStatus(r),r.submitted_at)).map(row=>({id:row.id,cells:[
              <><strong>{siteName(row.site_id)}</strong><span className="sub">{row.post??'Post unavailable'}</span></>,ref(row.outgoing_guard_id),ref(row.incoming_guard_id),time(row.submitted_at),<Badge value={handoverStatus(row)}/>,
              <button className="text-btn" onClick={()=>setDetail({kind:'handover',row})}>Open handover</button>,
            ]}))}/>}</Source>
        </Card>}
        {page==='sites'&&<div className="listing sections"><Card title="Permitted sites" subtitle="Current duty presence · staffing targets are unavailable">
          {coverageRows()}
        </Card><Card title="Site shift assignments" subtitle="Read-only roster for the selected sites">
          {filters([])}<Source resource={data.shifts}>{rows=>shiftTable(rows)}</Source>
        </Card></div>}
        {page==='guards'&&<Card title="Guard references" subtitle="Distinct guards on shifts at your permitted sites. The guard directory is unavailable.">
          {filters([],false)}
          <Source resource={data.shifts}>{rows=>{
            const guards=new Map<string,Shift>();
            for(const row of rows)if(!guards.has(row.guard_id))guards.set(row.guard_id,row);
            return <Table name="Guard references" heads={['Guard reference','Most recent scheduled site','Scheduled start','Action']} rows={[...guards.values()]
              .filter(row=>matches([row.guard_id,siteName(row.site_id)],'',row.started_at))
              .map(row=>({id:row.guard_id,cells:[<span title={row.guard_id}>{ref(row.guard_id)}</span>,siteName(row.site_id),time(row.started_at),
                <button className="text-btn" onClick={()=>setDetail({kind:'shift',row})}>Open shift</button>]}))}/>;
          }}</Source>
        </Card>}
        {page==='live'&&<div className="sections">
          <OperationsMap sites={mapSites} incidentSites={incidentSites} onSelectSite={chooseSite}/>
          <Card title="Live data availability"><p className="inline-note">The map uses authorized site records and urgent incidents from the latest refresh. Live guard locations, SOS alerts, geofences and patrol routes are awaiting implementation.</p></Card>
        </div>}
        {page==='reports'&&<Card title="Occurrence book report" subtitle="Filter by event date, then print or save as PDF from your browser."
          action={<Button onClick={()=>go('occurrence')}>Open occurrence book</Button>}>
          <p className="inline-note">Scheduled reports and other report exports are awaiting implementation.</p>
        </Card>}
        {page==='analytics'&&<div className="listing">
          <Metrics items={[dashboardMetrics[1],dashboardMetrics[2],dashboardMetrics[3],{title:'Needs review',value:urgent?.length,note:'Awaiting acknowledgement',icon:'warning'}]}/>
          <Card title="Incident activity" subtitle="Reports by event day · last seven days in Africa/Harare">
            <Source resource={data.incidents}>{()=>dayTotals&&<div className="chart" role="img" aria-label={days.map((d,i)=>d+': '+dayTotals[i]+' reports').join(', ')}>
              {days.map((day,i)=><div className="chart-column" key={day}><b>{dayTotals[i]}</b><div className="chart-bar" style={{height:(dayTotals[i]/Math.max(1,...dayTotals))*105+2}}/><small>{day.slice(5)}</small></div>)}
            </div>}</Source>
          </Card>
        </div>}
      </>}
      <footer>Baseguard SmartOps · Use approved telephone or radio procedures for emergencies.</footer>
    </div></main>
    {detail&&<Dialog title={detail.kind==='incident'?detail.row.public_number:detail.kind==='shift'?'Shift assignment':detail.kind==='handover'?'Shift handover':'Occurrence entry'} onClose={()=>setDetail(null)}>
      <p><strong>{siteName(detail.row.site_id)}</strong></p>
      {detail.kind==='incident'&&<IncidentDetail key={detail.row.id} incident={detail.row} onRefresh={refresh}/>}
      {detail.kind==='occurrence'&&<><Badge value={detail.row.category}/><p>Event {time(detail.row.event_at)} · Received {time(detail.row.received_at)}</p><p className="record-copy">{detail.row.narrative}</p></>}
      {detail.kind==='handover'&&<>
        <Badge value={handoverStatus(detail.row)}/><p>{detail.row.post??'Post unavailable'} · Submitted {time(detail.row.submitted_at)}</p>
        <p>Outgoing guard {ref(detail.row.outgoing_guard_id)} · Incoming guard {ref(detail.row.incoming_guard_id)}</p>
        {detail.row.accepted_at&&<p>Acknowledged {time(detail.row.accepted_at)}</p>}<p className="record-copy">{detail.row.notes}</p>
        {detail.row.equipment&&<><h3>Equipment</h3><p className="record-copy">{detail.row.equipment}</p></>}
        {!!detail.row.incident_ids?.length&&<><h3>Linked incidents</h3><ul>{detail.row.incident_ids.map(id=>{
          const row=incidents?.find(i=>i.id===id);
          return <li key={id}>{row?<button className="text-btn" onClick={()=>setDetail({kind:'incident',row})}>{row.public_number}</button>:ref(id)}</li>;
        })}</ul></>}
      </>}
      {detail.kind==='shift'&&<><Badge value={shiftStatus(detail.row,now)}/><p>Guard {ref(detail.row.guard_id)} · {detail.row.post??'Post unavailable'}</p><p>Scheduled start {time(detail.row.started_at)}</p>
        <p>{detail.row.checked_in_at?'Confirmed check-in '+time(detail.row.checked_in_at):'checked_in_at' in detail.row?'No confirmed check-in recorded.':'Check-in data unavailable.'}</p>
        {detail.row.ended_at&&<p>Shift end {time(detail.row.ended_at)}</p>}
      </>}
    </Dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
