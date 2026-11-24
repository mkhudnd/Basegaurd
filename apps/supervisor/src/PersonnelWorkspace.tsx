import {useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {displayDutyStatus,personnelCapabilities,personnelInitials,type PersonnelRecord,type PersonnelSort} from './personnel-domain';
import {errorMessage,inviteGuard,isAuthError,isPersonnelCapabilityUnavailable,loadPersonnelHistory,loadPersonnelPage,supabase,type PersonnelHistory,type Site} from './service';
import {localDate,time} from './incident-detail';
import {Badge,Button,Card,Dialog,Input,Metrics,Select,Table,label} from './ui';

const pageSize=25;
const detailTabs=['overview','assignments','shifts','attendance','incidents','account'] as const;
type DetailTab=typeof detailTabs[number];

export function PersonnelWorkspace({sites,siteId,onSiteChange,onWorkspaceRefresh,onNames}: {
  sites:Site[];siteId:string;onSiteChange:(id:string)=>void;onWorkspaceRefresh:()=>void;
  onNames:(names:Record<string,string>)=>void;
}) {
  const [search,setSearch]=useState('');
  const [debouncedSearch,setDebouncedSearch]=useState('');
  const [accountStatus,setAccountStatus]=useState('');
  const [dutyStatus,setDutyStatus]=useState('');
  const [sort,setSort]=useState<PersonnelSort>('name_asc');
  const [page,setPage]=useState(0);
  const [version,setVersion]=useState(0);
  const [result,setResult]=useState<Awaited<ReturnType<typeof loadPersonnelPage>>|null>(null);
  const [error,setError]=useState('');
  const [capabilityUnavailable,setCapabilityUnavailable]=useState(false);
  const [selected,setSelected]=useState<PersonnelRecord|null>(null);
  const [inviteOpen,setInviteOpen]=useState(false);

  useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search),250);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{setPage(0);setSelected(null);},[siteId,accountStatus,dutyStatus,debouncedSearch,sort]);
  useEffect(()=>{
    const request=new AbortController();setResult(null);setError('');setCapabilityUnavailable(false);
    void loadPersonnelPage({page,pageSize,siteId,search:debouncedSearch,accountStatus,dutyStatus,sort},sites,request.signal)
      .then(value=>{
        if(request.signal.aborted)return;
        setResult(value);onNames(Object.fromEntries(value.rows.map(row=>[row.id,row.display_name])));
      }).catch(reason=>{
        if(request.signal.aborted)return;
        if(isAuthError(reason))void supabase?.auth.signOut({scope:'local'});
        if(isPersonnelCapabilityUnavailable(reason)){setCapabilityUnavailable(true);return;}
        setError(errorMessage(reason,'Personnel records could not be loaded.'));
      });
    return()=>request.abort();
  },[page,siteId,accountStatus,dutyStatus,debouncedSearch,sort,version,sites,onNames]);

  const metrics=useMemo(()=>[
    {title:'Personnel',value:result?.metrics.total,note:'Guards in authorized site scope',icon:'guards' as const},
    {title:'Active accounts',value:result?.metrics.active_accounts,note:'Operational profile state',icon:'shield' as const},
    {title:'On duty',value:result?.metrics.on_duty,note:'Confirmed active presence',icon:'clock' as const},
    {title:'Active assignments',value:result?.metrics.active_assignments,note:'Personnel with a current site assignment',icon:'sites' as const},
  ],[result]);
  const pages=Math.max(1,Math.ceil((result?.count??0)/pageSize));
  const refresh=()=>{setVersion(value=>value+1);onWorkspaceRefresh();};

  return <div className="personnel-workspace">
    <Metrics items={metrics}/>
    <Card title="Personnel directory" subtitle="Site-scoped operational identities and verified duty state"
      action={<div className="card-actions"><Button onClick={refresh}>Refresh</Button><Button variant="primary" onClick={()=>setInviteOpen(true)}>Register guard</Button></div>}>
      <div className="personnel-filters">
        <label>Search<Input type="search" value={search} placeholder="Name or guard reference" onChange={event=>setSearch(event.target.value)}/></label>
        <label>Site<Select value={siteId} onChange={event=>onSiteChange(event.target.value)}><option value="">All permitted sites</option>{sites.map(site=><option value={site.id} key={site.id}>{site.name}</option>)}</Select></label>
        <label>Account<Select value={accountStatus} onChange={event=>setAccountStatus(event.target.value)}><option value="">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></label>
        <label>Duty<Select value={dutyStatus} onChange={event=>setDutyStatus(event.target.value)}><option value="">All duty states</option><option value="on_duty">On duty</option><option value="on_break">On break</option><option value="scheduled">Scheduled</option><option value="off_duty">Off duty</option></Select></label>
        <label>Sort<Select value={sort} onChange={event=>setSort(event.target.value as PersonnelSort)}><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="recent_duty_desc">Most recent check-in</option><option value="created_desc">Newest account</option></Select></label>
      </div>
      {capabilityUnavailable?<div className="capability-state"><strong>Personnel directory backend is not deployed.</strong><p>The site-scoped identity proposal is ready for review under <code>supabase/proposals</code>. Existing operational UUID references remain available.</p></div>
        :error?<div className="empty error" role="alert">{error}<Button onClick={()=>setVersion(value=>value+1)}>Retry</Button></div>
        :result===null?<p className="empty" role="status">Loading personnel…</p>
        :result.rows.length===0?<p className="empty">No personnel match the selected filters.</p>
        :<div className="table-wrap personnel-table-wrap" role="region" aria-label="Personnel directory" tabIndex={0}><table className="table personnel-table"><thead><tr><th>Guard</th><th>Sites</th><th>Account</th><th>Duty</th><th>Assignment</th><th>Last check-in</th><th/></tr></thead><tbody>
          {result.rows.map(person=><tr key={person.id}><td><div className="person-cell"><span className="person-avatar">{personnelInitials(person.display_name)}</span><span><strong>{person.display_name}</strong><small>{person.id}</small></span></div></td>
            <td>{person.assignments.length?person.assignments.map(item=>item.site_name).join(', '):'Unavailable'}</td><td><Badge value={person.account_active?'Active account':'Inactive account'}/></td>
            <td><Badge value={displayDutyStatus(person.duty_status)}/></td><td><Badge value={person.assignments.some(item=>item.status==='active')?'Active assignment':person.assignments.length?'Assignment ended':'Unavailable'}/></td>
            <td>{person.last_check_in_at?time(person.last_check_in_at):'Not recorded'}</td><td><button className="text-btn" onClick={()=>setSelected(person)}>Open profile</button></td></tr>)}
        </tbody></table></div>}
      <div className="pagination"><span>{!result||result.count===0?'No records':`${page*pageSize+1}–${Math.min((page+1)*pageSize,result.count)} of ${result.count}`}</span><div><Button disabled={page===0} onClick={()=>setPage(value=>Math.max(0,value-1))}>Previous</Button><span>Page {page+1} of {pages}</span><Button disabled={!result||page+1>=pages} onClick={()=>setPage(value=>value+1)}>Next</Button></div></div>
    </Card>
    {selected&&<GuardDetail person={selected} sites={sites} onClose={()=>setSelected(null)}/>}
    {inviteOpen&&<InviteGuardDialog sites={sites} selectedSiteId={siteId} onClose={()=>setInviteOpen(false)} onSaved={refresh}/>}
  </div>;
}

function GuardDetail({person,sites,onClose}:{person:PersonnelRecord;sites:Site[];onClose:()=>void}) {
  const [tab,setTab]=useState<DetailTab>('overview');
  const [history,setHistory]=useState<PersonnelHistory|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const request=new AbortController();setHistory(null);setError('');
    void loadPersonnelHistory(person,sites,request.signal).then(value=>{if(!request.signal.aborted)setHistory(value);})
      .catch(reason=>{if(!request.signal.aborted)setError(errorMessage(reason,'Operational history is unavailable.'));});
    return()=>request.abort();
  },[person,sites]);
  const capabilities=personnelCapabilities();
  return <div className="incident-detail-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><aside className="incident-detail-panel personnel-detail-panel" role="dialog" aria-modal="true" aria-label={'Guard '+person.display_name}>
    <div className="personnel-detail-head"><div className="person-cell"><span className="person-avatar large">{personnelInitials(person.display_name)}</span><div><span className="eyebrow">GUARD PROFILE</span><h2>{person.display_name}</h2><small>{person.id}</small></div></div><Button className="icon-only" aria-label="Close guard profile" onClick={onClose}>×</Button></div>
    <div className="profile-statuses"><Badge value={person.account_active?'Active account':'Inactive account'}/><Badge value={displayDutyStatus(person.duty_status)}/><Badge value={person.assignments.some(item=>item.status==='active')?'Active assignment':'No active assignment'}/></div>
    <div className="profile-tabs" role="tablist" aria-label="Guard profile sections">{detailTabs.map(value=><button key={value} role="tab" aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label(value)}</button>)}</div>
    <div className="profile-tab-content">
      {tab==='overview'&&<dl className="incident-facts"><div><dt>Employment status</dt><dd>Unavailable<small>No employment field exists in the current backend.</small></dd></div><div><dt>Account status</dt><dd>{person.account_active?'Active':'Inactive'}</dd></div><div><dt>Duty status</dt><dd>{displayDutyStatus(person.duty_status)}</dd></div><div><dt>Assignment status</dt><dd>{person.assignments.some(item=>item.status==='active')?'Active':'No current assignment'}</dd></div><div><dt>Current post</dt><dd>{person.current_post||'Not recorded'}</dd></div><div><dt>Account created</dt><dd>{time(person.created_at)}</dd></div></dl>}
      {tab==='assignments'&&(person.assignments.length?<div className="profile-list">{person.assignments.map(item=><article key={item.site_id+item.valid_from}><div><strong>{item.site_name}</strong><small>{label(item.role_at_site)} · From {localDate(item.valid_from)}{item.valid_to?' to '+localDate(item.valid_to):''}</small></div><Badge value={item.status}/></article>)}</div>:<p className="empty">No assignment records are available.</p>)}
      {tab==='shifts'&&<HistoryState history={history} error={error}>{value=><Table name="Guard shifts" heads={['Site / post','Start','Check-in','Status']} rows={value.shifts.map(shift=>({id:shift.id,cells:[<><strong>{sites.find(site=>site.id===shift.site_id)?.name??'Site unavailable'}</strong><span className="sub">{shift.post??'Post unavailable'}</span></>,time(shift.started_at),shift.checked_in_at?time(shift.checked_in_at):'Not recorded',<Badge value={shift.status}/>]}))}/>}</HistoryState>}
      {tab==='attendance'&&<HistoryState history={history} error={error}>{value=>{const rows=value.shifts.filter(shift=>shift.checked_in_at);return rows.length?<Table name="Confirmed attendance" heads={['Site','Scheduled start','Confirmed check-in','Shift status']} rows={rows.map(shift=>({id:shift.id,cells:[sites.find(site=>site.id===shift.site_id)?.name??'Site unavailable',time(shift.started_at),time(shift.checked_in_at!),<Badge value={shift.status}/>]}))}/>:<p className="empty">No confirmed check-ins are recorded in the available shift history.</p>;}}</HistoryState>}
      {tab==='incidents'&&<HistoryState history={history} error={error}>{value=><Table name="Guard incidents" heads={['Reference','Category','Reported','Status']} rows={value.incidents.map(incident=>({id:incident.id,cells:[incident.public_number,label(incident.category),time(incident.reported_at),<Badge value={incident.status}/>]}))}/>}</HistoryState>}
      {tab==='account'&&<div className="account-capabilities"><div className="capability-state"><strong>Privileged account administration is unavailable.</strong><p>Profile edits, account activation and assignment changes require reviewed server-side contracts.</p></div><div className="modal-actions"><Button disabled={!capabilities.editProfile}>Edit personnel</Button><Button disabled={!capabilities.changeAccountStatus}>{person.account_active?'Deactivate account':'Activate account'}</Button><Button disabled={!capabilities.changeAssignments}>Manage assignments</Button></div><p className="inline-note">Permanent deletion is intentionally unavailable pending a retention and audit policy.</p></div>}
    </div>
  </aside></div>;
}

function HistoryState({history,error,children}:{history:PersonnelHistory|null;error:string;children:(history:PersonnelHistory)=>ReactNode}) {
  if(error)return <p className="empty error" role="alert">{error}</p>;
  if(history===null)return <p className="empty" role="status">Loading operational history…</p>;
  return children(history);
}

function InviteGuardDialog({sites,selectedSiteId,onClose,onSaved}:{sites:Site[];selectedSiteId:string;onClose:()=>void;onSaved:()=>void}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const values=new FormData(event.currentTarget);setBusy(true);setError('');setMessage('');
    try{const receipt=await inviteGuard({email:String(values.get('email')),displayName:String(values.get('display_name')),siteId:String(values.get('site_id'))});setMessage(receipt);onSaved();}
    catch(reason){setError(errorMessage(reason,'Guard invitation could not be confirmed.'));}finally{setBusy(false);}
  }
  return <Dialog title="Register guard account" onClose={onClose}><form className="personnel-form" onSubmit={submit}><p>The invitation is created by the existing secured Edge Function. No password or privileged key is handled by this browser.</p><label>Display name<Input name="display_name" minLength={2} maxLength={120} required/></label><label>Work email<Input name="email" type="email" autoComplete="off" required/></label><label>Initial site<Select name="site_id" defaultValue={selectedSiteId||sites[0]?.id} required>{sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}</Select></label><div className="modal-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Waiting for server confirmation…':'Send invitation'}</Button></div>{message&&<p className="success" role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}</form></Dialog>;
}
