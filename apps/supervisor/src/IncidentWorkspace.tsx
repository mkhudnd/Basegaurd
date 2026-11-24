import {useEffect,useMemo,useState} from 'react';
import {displayIncidentStatus,type IncidentSort} from './incident-domain';
import {errorMessage,isAuthError,loadIncidentCounts,loadIncidentPage,supabase,type Incident,type IncidentCounts,type Site} from './service';
import {IncidentDetail,time} from './incident-detail';
import {Badge,Button,Card,Input,Metrics,Select,label} from './ui';

const pageSize=25;
const tabs=[['','All'],['reported','Needs review'],['acknowledged','Acknowledged'],['in_progress','In progress'],['resolved','Resolved'],['closed','Closed']] as const;
const severities=['low','medium','high','critical'];

export function IncidentWorkspace({sites,siteId,onSiteChange,onDashboardRefresh}:{
  sites:Site[];siteId:string;onSiteChange:(id:string)=>void;onDashboardRefresh:()=>void;
}) {
  const [search,setSearch]=useState('');
  const [debouncedSearch,setDebouncedSearch]=useState('');
  const [severity,setSeverity]=useState('');
  const [status,setStatus]=useState('');
  const [date,setDate]=useState('');
  const [sort,setSort]=useState<IncidentSort>('received_desc');
  const [page,setPage]=useState(0);
  const [version,setVersion]=useState(0);
  const [rows,setRows]=useState<Incident[]|null>(null);
  const [count,setCount]=useState(0);
  const [counts,setCounts]=useState<IncidentCounts|null>(null);
  const [error,setError]=useState('');
  const [countsError,setCountsError]=useState('');
  const [selected,setSelected]=useState<Incident|null>(null);
  function handleError(value:unknown,fallback:string){
    if(isAuthError(value))void supabase?.auth.signOut({scope:'local'});
    return errorMessage(value,isAuthError(value)?'Your session expired. Sign in again.':fallback);
  }
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search),250);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{setPage(0);setSelected(null);},[siteId,severity,status,date,debouncedSearch,sort]);
  useEffect(()=>{
    const request=new AbortController();setRows(null);setError('');
    void loadIncidentPage({page,pageSize,siteId,severity,status,date,search:debouncedSearch,sort},request.signal)
      .then(result=>{if(!request.signal.aborted){setRows(result.rows);setCount(result.count);}})
      .catch(e=>{if(!request.signal.aborted)setError(handleError(e,'Incidents could not be loaded.'));});
    return()=>request.abort();
  },[page,siteId,severity,status,date,debouncedSearch,sort,version]);
  useEffect(()=>{
    const request=new AbortController();setCounts(null);setCountsError('');
    void loadIncidentCounts(siteId,request.signal).then(result=>{if(!request.signal.aborted)setCounts(result);})
      .catch(e=>{if(!request.signal.aborted)setCountsError(handleError(e,'Incident statistics are unavailable.'));});
    return()=>request.abort();
  },[siteId,version]);

  const pages=Math.max(1,Math.ceil(count/pageSize));
  const siteName=(id:string)=>sites.find(site=>site.id===id)?.name??'Site unavailable';
  const metrics=useMemo(()=>[
    {title:'Total incidents',value:counts?.all,note:'Authorized site scope',icon:'incidents' as const},
    {title:'Needs review',value:counts?.reported,note:'Awaiting acknowledgement',icon:'warning' as const},
    {title:'In progress',value:counts?.in_progress,note:'Supervisor follow-up active',icon:'clock' as const},
    {title:'Resolved',value:counts?.resolved,note:'Awaiting closure where required',icon:'shield' as const},
  ],[counts]);
  function refresh(){setVersion(v=>v+1);onDashboardRefresh();}
  function changeStatus(next:string){setStatus(next);setPage(0);}

  return <div className="incident-workspace">
    <Metrics items={metrics}/>{countsError&&<p className="inline-note error" role="alert">{countsError}</p>}
    <Card title="Incident register" subtitle="Server-paginated records from permitted sites" action={<Button onClick={refresh}>Refresh incidents</Button>}>
      <div className="status-tabs" role="tablist" aria-label="Incident status">
        {tabs.map(([value,title])=><button role="tab" aria-selected={status===value} className={status===value?'active':''} key={value||'all'} onClick={()=>changeStatus(value)}>
          {title}{counts&&<span>{counts[value as keyof IncidentCounts]??counts.all}</span>}
        </button>)}
      </div>
      <div className="incident-filters">
        <label>Search<Input type="search" value={search} placeholder="Reference, category or description" onChange={e=>setSearch(e.target.value)}/></label>
        <label>Site<Select value={siteId} onChange={e=>onSiteChange(e.target.value)}><option value="">All permitted sites</option>{sites.map(site=><option value={site.id} key={site.id}>{site.name}</option>)}</Select></label>
        <label>Severity<Select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="">All severities</option>{severities.map(value=><option value={value} key={value}>{label(value)}</option>)}</Select></label>
        <label>Status<Select value={status} onChange={e=>changeStatus(e.target.value)}><option value="">All statuses</option>{tabs.slice(1).map(([value,title])=><option value={value} key={value}>{title}</option>)}</Select></label>
        <label>Reported date<Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label>Sort<Select value={sort} onChange={e=>setSort(e.target.value as IncidentSort)}>
          <option value="received_desc">Newest received</option><option value="received_asc">Oldest received</option>
          <option value="reported_desc">Newest reported</option><option value="reported_asc">Oldest reported</option>
          <option value="reference_asc">Reference A–Z</option><option value="reference_desc">Reference Z–A</option>
        </Select></label>
      </div>
      {error?<div className="empty error" role="alert">{error}<Button onClick={()=>setVersion(v=>v+1)}>Retry</Button></div>
        :rows===null?<p className="empty" role="status">Loading incidents…</p>
        :rows.length===0?<p className="empty">No incidents match the selected filters.</p>
        :<div className="table-wrap incident-table-wrap" role="region" aria-label="Incident register" tabIndex={0}><table className="table incident-table">
          <thead><tr><SortHead title="Reference" active={sort.startsWith('reference')} onClick={()=>setSort(sort==='reference_asc'?'reference_desc':'reference_asc')}/>
            <th>Category</th><th>Site</th><th>Severity</th>
            <th>Status</th><SortHead title="Reported" active={sort.startsWith('reported')} onClick={()=>setSort(sort==='reported_desc'?'reported_asc':'reported_desc')}/><th/></tr></thead>
          <tbody>{rows.map(row=><tr key={row.id} className={selected?.id===row.id?'selected':''}>
            <td><strong>{row.public_number}</strong><span className="sub">Received {time(row.received_at)}</span></td><td>{label(row.category)}</td><td>{siteName(row.site_id)}</td>
            <td><Badge value={row.severity}/></td><td><Badge value={displayIncidentStatus(row.status)}/></td><td>{time(row.reported_at)}</td>
            <td><button className="text-btn" onClick={()=>setSelected(row)}>Review</button></td></tr>)}</tbody>
        </table></div>}
      <div className="pagination"><span>{count===0?'No records':`${page*pageSize+1}–${Math.min((page+1)*pageSize,count)} of ${count}`}</span>
        <div><Button disabled={page===0} onClick={()=>setPage(value=>Math.max(0,value-1))}>Previous</Button><span>Page {page+1} of {pages}</span><Button disabled={page+1>=pages} onClick={()=>setPage(value=>value+1)}>Next</Button></div></div>
    </Card>
    {selected&&<div className="incident-detail-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelected(null);}}>
      <aside className="incident-detail-panel" role="dialog" aria-modal="true" aria-label={'Incident '+selected.public_number}>
        <IncidentDetail incident={selected} siteName={siteName(selected.site_id)} onClose={()=>setSelected(null)} onRefresh={refresh}/>
      </aside></div>}
  </div>;
}

function SortHead({title,active,onClick}:{title:string;active:boolean;onClick:()=>void}) {
  return <th><button className={active?'sort-button active':'sort-button'} onClick={onClick}>{title}<span aria-hidden="true">↕</span></button></th>;
}
